// Documents sent out for review.
// Admin (logged in, admin rights):
//   { action: "invite", review_id, board?: true, slips?: "A12, B7", emails?: "a@x.com, Pat Lee <p@y.com>" }
//        -> adds reviewers (skipping anyone already invited) and emails each new one a private link
//   { action: "resend", reviewer_id }   -> emails that reviewer's link again
// Reviewer (no login; the private link's token is the key):
//   { action: "get", token }            -> the review, the reviewer's own response, and a link to the file
//   { action: "respond", token, decision: "approved" | "changes" | "comment", comment }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://newberngrand.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const linkify = (s: string) => esc(s)
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1c5d6e">$1</a>')
  .replace(/\n/g, "<br>");
const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Review = { id: string; title: string; message: string; due_date: string | null; status: string; storage_path: string; file_name: string; size_bytes: number | null };
type Reviewer = { id: string; email: string; name: string; token: string };

function fmtDue(d: string | null) {
  if (!d) return "";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function buildHtml(rv: Review, r: Reviewer, sender: string) {
  const link = `${SITE}/review.html?t=${r.token}`;
  return `<div style="font-family:Arial,sans-serif;color:#1c2733;max-width:600px;line-height:1.55">
    <p>${r.name ? `Dear ${esc(r.name)},` : "Hello,"}</p>
    <p>${esc(sender)} at New Bern Grand Marina has asked you to review <strong>${esc(rv.title)}</strong>.</p>
    ${rv.message ? `<div style="border-left:3px solid #c9a24a;padding:2px 0 2px 12px;margin:14px 0">${linkify(rv.message)}</div>` : ""}
    ${rv.due_date ? `<p>Please respond by <strong>${esc(fmtDue(rv.due_date))}</strong>.</p>` : ""}
    <p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#0b2540;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Review the document &rarr;</a></p>
    <p style="color:#5c6b7a;font-size:13px;margin-top:-10px">No login needed. This link is just for you, so please don't forward it. You can approve the document, ask for changes, or leave a comment.</p>
    <p style="margin-top:24px">New Bern Grand Marina<br>134 Craven St, New Bern, NC &middot; (252) 638-0318<br><a href="${SITE}" style="color:#1c5d6e">newberngrand.com</a></p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Invalid request" }); }
  const action = String(b.action ?? "");

  /* ---------- Reviewer side: the token is the key ---------- */
  if (action === "get" || action === "respond") {
    const t = String(b.token ?? "");
    if (!UUID.test(t)) return reply(404, { error: "This review link isn't valid." });
    const { data: r } = await db.from("doc_reviewers").select("id, review_id, name, email, viewed_at, decision, comment, responded_at").eq("token", t).maybeSingle();
    if (!r) return reply(404, { error: "This review link isn't valid any more. It may have been removed." });
    const { data: rv } = await db.from("doc_reviews").select("*").eq("id", r.review_id).maybeSingle();
    if (!rv) return reply(404, { error: "This review no longer exists." });

    if (action === "get") {
      const { data: signed } = await db.storage.from("marina-docs").createSignedUrl(rv.storage_path, 3600, { download: false });
      if (!r.viewed_at) await db.from("doc_reviewers").update({ viewed_at: new Date().toISOString() }).eq("id", r.id);
      return reply(200, {
        title: rv.title, message: rv.message, due_date: rv.due_date, status: rv.status, file_name: rv.file_name,
        size_bytes: rv.size_bytes, url: signed?.signedUrl ?? null,
        name: r.name, decision: r.decision, comment: r.comment, responded_at: r.responded_at,
      });
    }
    if (rv.status !== "open") return reply(409, { error: "This review has been closed, so responses can't be changed." });
    const decision = String(b.decision ?? "");
    const comment = String(b.comment ?? "").trim();
    if (!["approved", "changes", "comment"].includes(decision)) return reply(400, { error: "Please choose a response." });
    if (comment.length > 4000) return reply(400, { error: "Please keep comments under 4,000 characters." });
    if (decision !== "approved" && !comment) return reply(400, { error: "Please add a comment saying what should change." });
    const now = new Date().toISOString();
    const { error } = await db.from("doc_reviewers").update({ decision, comment: comment || null, responded_at: now, viewed_at: r.viewed_at ?? now }).eq("id", r.id);
    if (error) return reply(500, { error: error.message });
    await db.from("activity_log").insert({ slip: null, is_member: false, action: "review_" + decision, target_type: "doc_review", target_id: rv.id, target_label: `${rv.title} (${r.name || r.email})` }).then(() => {}, () => {});
    return reply(200, { ok: true, responded_at: now });
  }

  /* ---------- Admin side ---------- */
  const auth = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(auth);
  if (!caller?.user) return reply(401, { error: "Please log in again." });
  const { data: me } = await db.from("members").select("slip, active, owner_name, board_name").eq("user_id", caller.user.id).maybeSingle();
  const { data: isAdmin } = await db.rpc("admin_by_uid", { p_uid: caller.user.id });
  if (!me?.active || !isAdmin) return reply(403, { error: "Only administrators can send documents for review." });
  if (!Deno.env.get("RESEND_API_KEY")) return reply(500, { error: "Email isn't set up (RESEND_API_KEY missing)." });
  const from = Deno.env.get("MAIL_FROM") ?? Deno.env.get("RESET_FROM") ?? "New Bern Grand Marina <onboarding@resend.dev>";
  const sender = (me.board_name || String(me.owner_name ?? "").split(",")[0] || "The marina office").trim();

  async function send(rv: Review, list: Reviewer[]) {
    let failed = 0;
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch.map((r) => ({ from, to: [r.email], subject: `Please review: ${rv.title}`, html: buildHtml(rv, r, sender) }))),
      });
      const ok = res.ok, err = ok ? null : (await res.text()).slice(0, 300);
      if (!ok) failed += batch.length;
      await db.from("doc_reviewers").update(ok ? { email_status: "sent", email_error: null, invited_at: new Date().toISOString() } : { email_status: "failed", email_error: err })
        .in("id", batch.map((r) => r.id));
    }
    return failed;
  }

  if (action === "resend") {
    const id = String(b.reviewer_id ?? "");
    if (!UUID.test(id)) return reply(400, { error: "Invalid reviewer" });
    const { data: r } = await db.from("doc_reviewers").select("id, review_id, email, name, token").eq("id", id).maybeSingle();
    if (!r) return reply(404, { error: "That reviewer is no longer on the list." });
    const { data: rv } = await db.from("doc_reviews").select("*").eq("id", r.review_id).maybeSingle();
    const failed = await send(rv as Review, [r as Reviewer]);
    return failed ? reply(502, { error: "The email could not be sent. Please try again later." }) : reply(200, { ok: true });
  }

  if (action === "invite") {
    const id = String(b.review_id ?? "");
    if (!UUID.test(id)) return reply(400, { error: "Invalid review" });
    const { data: rv } = await db.from("doc_reviews").select("*").eq("id", id).maybeSingle();
    if (!rv) return reply(404, { error: "That review no longer exists." });

    type Want = { email: string; name: string; slip: string | null; via: string };
    const want = new Map<string, Want>();
    const add = (w: Want) => { const k = w.email.toLowerCase(); if (!want.has(k)) want.set(k, w); };
    const noEmail: string[] = [], unknown: string[] = [], badEmail: string[] = [];
    const nameOf = (m: { owner_name?: string | null; board_name?: string | null }) =>
      (m.board_name || String(m.owner_name ?? "").split(",")[0] || "").trim();

    if (b.board) {
      const { data } = await db.from("members").select("slip, owner_name, board_name, email").eq("is_board", true).eq("active", true);
      for (const m of data ?? []) {
        const e = String(m.email ?? "").trim();
        if (EMAIL.test(e)) add({ email: e, name: nameOf(m), slip: m.slip, via: "board" }); else noEmail.push(m.slip);
      }
    }
    const slips = [...new Set(String(b.slips ?? "").toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z0-9-]{1,20}$/.test(x)))];
    if (slips.length) {
      const { data } = await db.from("members").select("slip, owner_name, board_name, email").in("slip", slips).eq("active", true);
      const found = new Set((data ?? []).map((m) => m.slip));
      unknown.push(...slips.filter((s) => !found.has(s)));
      for (const m of data ?? []) {
        const e = String(m.email ?? "").trim();
        if (EMAIL.test(e)) add({ email: e, name: nameOf(m), slip: m.slip, via: "slip" }); else noEmail.push(m.slip);
      }
    }
    // "Pat Lee <pat@x.com>", "pat@x.com", one per line or comma-separated.
    for (const part of String(b.emails ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
      const m = part.match(/^(.*?)\s*<([^>]+)>$/);
      const e = (m ? m[2] : part).trim(), n = (m ? m[1] : "").replace(/^["']|["']$/g, "").trim();
      if (EMAIL.test(e) && e.length <= 200) add({ email: e, name: n.slice(0, 120), slip: null, via: "email" }); else badEmail.push(part);
    }
    if (!want.size) return reply(400, { error: "No one to invite. Tick the board, or enter slips or email addresses.", unknown, noEmail, badEmail });

    const { data: existing } = await db.from("doc_reviewers").select("email").eq("review_id", id);
    const have = new Set((existing ?? []).map((x) => String(x.email).toLowerCase()));
    const fresh = [...want.values()].filter((w) => !have.has(w.email.toLowerCase()));
    let inserted: Reviewer[] = [];
    if (fresh.length) {
      const { data, error } = await db.from("doc_reviewers").insert(fresh.map((w) => ({ review_id: id, ...w }))).select("id, email, name, token");
      if (error) return reply(500, { error: error.message });
      inserted = data as Reviewer[];
    }
    const failed = inserted.length ? await send(rv as Review, inserted) : 0;
    return reply(200, { ok: true, added: inserted.length, already: want.size - fresh.length, failed, unknown, noEmail, badEmail });
  }

  return reply(400, { error: "Unknown action" });
});
