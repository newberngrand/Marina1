// Admin-only member announcements.
//   { action: "preview", audience, docks?, slips? }                  -> recipient count
// audience: "all" | "voting" | "docks" (docks: ["A","C"]) | "slips" (slips: "A12, B7") | "ltc" | "stc" | "employee"
// all / voting / docks mean slip owners (certificated); ltc / stc / employee are those logins.
//   { action: "test", subject, body, event_id?, to }                 -> one test email
//   { action: "send", subject, body, audience, event_id? }           -> create + start sending
//   { action: "resume", announcement_id }                            -> keep sending a paused one
// event_id may be "portal" for a button to the Member Portal instead of an event.
// Each recipient's button is a personal link (go.html?t=<token>) so the Admin page
// can show who clicked; test emails link straight to the page.
// Sends in batches of up to 100 through Resend. If Resend refuses because of a
// sending limit, the announcement is paused and can be resumed later; every
// address gets the email exactly once.
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

type Recip = { email: string; name: string; slips: string[] };

type Btn = { label: string; page: string } | null;
// What the email's button points to: an event, the Member Portal, or nothing.
function buttonFor(ev: { id: string; title: string } | null, portal: boolean): Btn {
  if (ev) return { label: ev.title, page: `event.html?id=${ev.id}` };
  if (portal) return { label: "Go to the Member Portal", page: "member-portal.html" };
  return null;
}

function buildHtml(body: string, r: Recip, btn: Btn, link: string) {
  const greet = r.name ? `Dear ${esc(r.name)},` : "Dear Member,";
  const button = btn
    ? `<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#0b2540;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">${esc(btn.label)} &rarr;</a></p>
       <p style="color:#5c6b7a;font-size:13px;margin-top:-10px">You'll be asked to log in with your slip number and password.</p>`
    : "";
  const slipLine = r.slips.length
    ? `You're receiving this as the owner of record for slip${r.slips.length > 1 ? "s" : ""} ${esc(r.slips.join(", "))} at New Bern Grand Marina.`
    : "You're receiving this as a New Bern Grand Marina member.";
  return `<div style="font-family:Arial,sans-serif;color:#1c2733;max-width:600px;line-height:1.55">
    <p>${greet}</p>
    <div>${linkify(body)}</div>
    ${button}
    <p style="margin-top:24px">New Bern Grand Marina<br>134 Craven St, New Bern, NC &middot; (252) 638-0318<br><a href="${SITE}" style="color:#1c5d6e">newberngrand.com</a></p>
    <p style="color:#8a96a3;font-size:12px;border-top:1px solid #e2e6ea;padding-top:10px">${slipLine}</p>
  </div>`;
}

async function resendBatch(messages: unknown[]) {
  const r = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  return { status: r.status, text: r.ok ? "" : await r.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return reply(401, { error: "Please log in again." });
  const { data: me } = await db.from("members").select("slip, active, email").eq("user_id", caller.user.id).maybeSingle();
  // Admin rights follow the owner: any slip sharing an admin's email counts.
  const { data: isAdmin } = await db.rpc("admin_by_uid", { p_uid: caller.user.id });
  if (!me?.active || !isAdmin) return reply(403, { error: "Only board administrators can send announcements." });
  if (!Deno.env.get("RESEND_API_KEY")) return reply(500, { error: "Email isn't set up (RESEND_API_KEY missing)." });
  const from = Deno.env.get("MAIL_FROM") ?? Deno.env.get("RESET_FROM") ?? "New Bern Grand Marina <onboarding@resend.dev>";

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Invalid request" }); }
  const action = String(b.action ?? "");

  // Who an audience covers. Returns the recipients plus any slip numbers that didn't match.
  function parseTarget() {
    const audience = ["all", "voting", "docks", "slips", "ltc", "stc", "employee"].includes(String(b.audience)) ? String(b.audience) : "all";
    const docks = Array.isArray(b.docks) ? (b.docks as unknown[]).map((d) => String(d).toUpperCase()).filter((d) => /^[A-Z]$/.test(d)) : [];
    const slips = String(b.slips ?? "").toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z0-9-]{1,20}$/.test(x));
    return { audience, docks: [...new Set(docks)].sort(), slips: [...new Set(slips)] };
  }
  async function recipients(t: { audience: string; docks: string[]; slips: string[] }): Promise<{ list: Recip[]; unknown: string[]; noEmail: string[] }> {
    let q = db.from("members").select("slip, owner_name, email, can_vote").eq("active", true).eq("is_admin", false);
    if (["all", "voting", "docks"].includes(t.audience)) q = q.eq("member_class", "certificated");
    if (["ltc", "stc", "employee"].includes(t.audience)) q = q.eq("member_class", t.audience);
    if (t.audience === "voting") q = q.eq("can_vote", true);
    if (t.audience === "slips") q = q.in("slip", t.slips.length ? t.slips : ["-none-"]);
    const { data: rows } = await q;
    let data = rows ?? [];
    if (t.audience === "docks") data = data.filter((m) => t.docks.includes(String(m.slip).charAt(0).toUpperCase()));
    const found = new Set(data.map((m) => m.slip));
    const unknown = t.audience === "slips" ? t.slips.filter((x) => !found.has(x)) : [];
    const noEmail: string[] = [];
    const map = new Map<string, Recip>();
    for (const m of data) {
      const e = String(m.email ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { noEmail.push(m.slip); continue; }
      const k = e.toLowerCase();
      const r = map.get(k) ?? { email: e, name: m.owner_name ?? "", slips: [] };
      r.slips.push(m.slip);
      map.set(k, r);
    }
    for (const r of map.values()) r.slips.sort((a, c) => a.localeCompare(c, undefined, { numeric: true }));
    return { list: [...map.values()], unknown, noEmail };
  }
  async function eventInfo(id: unknown) {
    if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const { data } = await db.from("events").select("id, title").eq("id", String(id)).maybeSingle();
    return data;
  }
  function checkText() {
    const subject = String(b.subject ?? "").trim(), body = String(b.body ?? "").trim();
    if (!subject || subject.length > 200) return { err: "Please enter a subject (up to 200 characters)." };
    if (!body || body.length > 20000) return { err: "Please enter a message." };
    return { subject, body };
  }

  // Send pending recipients for one announcement until done or a limit is hit.
  async function pump(id: string) {
    const { data: a } = await db.from("announcements").select("*").eq("id", id).maybeSingle();
    if (!a) return { error: "Announcement not found" };
    const btn = buttonFor(await eventInfo(a.event_id), a.portal_button);
    let note = "";
    while (true) {
      const { data: batch } = await db.from("announcement_recipients").select("email, name, slips, token")
        .eq("announcement_id", id).eq("status", "pending").limit(100);
      if (!batch?.length) break;
      const res = await resendBatch(batch.map((r) => ({ from, to: [r.email], subject: a.subject, html: buildHtml(a.body, r as Recip, btn, `${SITE}/go.html?t=${r.token}`) })));
      if (res.status === 429 || /quota|limit/i.test(res.text)) {
        note = "Paused: the email service's sending limit was reached. Use Resume later (the free plan allows 100 emails per day).";
        break;
      }
      const now = new Date().toISOString();
      const emails = batch.map((r) => r.email);
      if (res.status >= 200 && res.status < 300) {
        await db.from("announcement_recipients").update({ status: "sent", sent_at: now }).eq("announcement_id", id).in("email", emails);
      } else {
        await db.from("announcement_recipients").update({ status: "failed", error: `${res.status} ${res.text}`.slice(0, 500) })
          .eq("announcement_id", id).in("email", emails);
        note = `Some emails failed: ${res.status} ${res.text}`.slice(0, 300);
      }
    }
    const counts = async (st: string) =>
      (await db.from("announcement_recipients").select("email", { count: "exact", head: true }).eq("announcement_id", id).eq("status", st)).count ?? 0;
    const [sent, failed, pending] = await Promise.all([counts("sent"), counts("failed"), counts("pending")]);
    const status = pending ? "paused" : "done";
    await db.from("announcements").update({ sent, failed, status, note }).eq("id", id);
    return { id, sent, failed, pending, status, note };
  }

  if (action === "preview") {
    const t = parseTarget();
    const { list, unknown, noEmail } = await recipients(t);
    return reply(200, { count: list.length, slips: list.reduce((n, r) => n + r.slips.length, 0), unknown, no_email: noEmail });
  }

  if (action === "test") {
    const t = checkText();
    if ("err" in t) return reply(400, { error: t.err });
    const to = String(b.to ?? me.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return reply(400, { error: "Enter an email address for the test." });
    const ev = await eventInfo(b.event_id);
    const btn = buttonFor(ev, b.event_id === "portal");
    const sample = { email: to, name: "Sample Owner", slips: ["A12"] };
    if (!btn) {
      const res = await resendBatch([{ from, to: [to], subject: "[TEST] " + t.subject, html: buildHtml(t.body, sample, null, "") }]);
      if (res.status >= 300) return reply(400, { error: `Test email failed: ${res.status} ${res.text}` });
      return reply(200, { ok: true, message: `Test sent to ${to}.` });
    }
    // With a button, keep the test in the Sent list (marked TEST) with a tracked link,
    // so the admin can click it and see the click recorded.
    const { data: a, error } = await db.from("announcements").insert({
      subject: "[TEST] " + t.subject, body: t.body, audience: "slips", target: to, event_id: ev?.id ?? null,
      portal_button: !ev, tracked: true, is_test: true, sent_by: me.slip, total: 1,
    }).select("id").single();
    if (error || !a) return reply(500, { error: error?.message ?? "Could not record the test." });
    const { data: rec } = await db.from("announcement_recipients")
      .insert({ announcement_id: a.id, email: to, name: "", slips: [] }).select("token").single();
    const res = await resendBatch([{ from, to: [to], subject: "[TEST] " + t.subject,
      html: buildHtml(t.body, sample, btn, `${SITE}/go.html?t=${rec?.token}`) }]);
    const ok = res.status < 300;
    await db.from("announcement_recipients").update(ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error: `${res.status} ${res.text}`.slice(0, 500) })
      .eq("announcement_id", a.id);
    await db.from("announcements").update({ sent: ok ? 1 : 0, failed: ok ? 0 : 1, status: "done" }).eq("id", a.id);
    if (!ok) return reply(400, { error: `Test email failed: ${res.status} ${res.text}` });
    return reply(200, { ok: true, tracked: true, message: `Test sent to ${to}. It's listed under Sent announcements (marked TEST) so you can click its button and check Who clicked.` });
  }

  if (action === "send") {
    const t = checkText();
    if ("err" in t) return reply(400, { error: t.err });
    const target = parseTarget();
    const audience = target.audience;
    if (audience === "docks" && !target.docks.length) return reply(400, { error: "Pick at least one dock." });
    if (audience === "slips" && !target.slips.length) return reply(400, { error: "Type at least one slip number." });
    const { list, unknown } = await recipients(target);
    if (unknown.length) return reply(400, { error: "These slips weren't found: " + unknown.join(", ") + ". Fix or remove them, then send again." });
    if (!list.length) return reply(400, { error: "None of those slips have an email address on file." });
    const targetText = audience === "docks" ? target.docks.join(", ") : audience === "slips" ? target.slips.join(", ") : "";
    const ev = await eventInfo(b.event_id);
    const { data: a, error } = await db.from("announcements").insert({
      subject: t.subject, body: t.body, audience, target: targetText, event_id: ev?.id ?? null,
      portal_button: !ev && b.event_id === "portal", tracked: !!ev || b.event_id === "portal", sent_by: me.slip, total: list.length,
    }).select("id").single();
    if (error || !a) return reply(500, { error: error?.message ?? "Could not create the announcement." });
    await db.from("announcement_recipients").insert(list.map((r) => ({ announcement_id: a.id, email: r.email, name: r.name, slips: r.slips })));
    await db.from("activity_log").insert({ user_id: caller.user.id, slip: me.slip, is_member: true, action: "announcement_sent",
      target_type: "announcement", target_id: a.id, target_label: t.subject, details: { recipients: list.length, audience, target: targetText } });
    return reply(200, await pump(a.id));
  }

  if (action === "resume") {
    const id = String(b.announcement_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply(400, { error: "Invalid announcement" });
    await db.from("announcements").update({ status: "sending" }).eq("id", id);
    return reply(200, await pump(id));
  }

  return reply(400, { error: "Unknown action" });
});
