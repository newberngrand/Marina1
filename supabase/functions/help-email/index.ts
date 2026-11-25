// Emails the marina office about a new help request (called by the database right after a
// request is saved, with { id }). Sends to the addresses set for the request's topic
// (site_settings.help_notify_topics, JSON { topic: "a@x, b@y" }), or the default
// (site_settings.help_notify_email) when that topic has none. Each request is emailed at most once. Replying to the email goes to the member when they gave an email.
//
// Secrets: RESEND_API_KEY (required); MAIL_FROM or RESET_FROM for the sender.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const row = (k: string, v: string) =>
  `<tr><td style="padding:6px 12px 6px 0;color:#5c6b7a;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:bold">${v}</td></tr>`;
const CLASS: Record<string, string> = { certificated: "Slip owner", ltc: "Long-term cruiser", stc: "Transient", employee: "Employee" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let id = "";
  try { id = String((await req.json()).id ?? ""); } catch { return json(400, { error: "Invalid request" }); }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Invalid request" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: h } = await db.from("help_requests").select("*").eq("id", id).maybeSingle();
  if (!h) return json(404, { error: "No such request" });
  if (h.notified_at) return json(200, { already: true });

  const { data: settings } = await db.from("site_settings").select("key, value").in("key", ["help_notify_email", "help_notify_topics"]);
  const map: Record<string, string> = {};
  for (const x of settings ?? []) map[x.key] = x.value;
  let topics: Record<string, string> = {};
  try { topics = JSON.parse(map.help_notify_topics || "{}"); } catch { topics = {}; }
  const list = (v: unknown) => String(v ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  const to = list(topics[h.topic]).length ? list(topics[h.topic]) : list(map.help_notify_email);
  if (!to.length) return json(200, { skipped: "no notify address set" });
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json(500, { error: "RESEND_API_KEY not set" });

  // Claim the request so a repeat call can't send it twice.
  const { data: claimed } = await db.from("help_requests").update({ notified_at: new Date().toISOString() })
    .eq("id", id).is("notified_at", null).select("id");
  if (!claimed?.length) return json(200, { already: true });

  const who = (h.member_class && h.member_class !== "certificated" ? `${CLASS[h.member_class] ?? h.member_class}${h.via_email ? "" : " login"}` : h.slip ? `Slip ${h.slip}` : "Member") + (h.via_email ? " (from an email link, no login)" : "");
  const wants = [h.contact_text ? "Text" : "", h.contact_call ? "Call" : ""].filter(Boolean).join(" or ") || (h.email ? "Email" : "");
  const phone = h.phone ? `${esc(h.phone)} &nbsp;<a href="tel:${esc(h.phone.replace(/[^\d+]/g, ""))}">Call</a> &middot; <a href="sms:${esc(h.phone.replace(/[^\d+]/g, ""))}">Text</a>` : "";
  const html = `<div style="font-family:Arial,sans-serif;color:#1c2733;max-width:560px">
    <h2 style="color:#0b2540;margin:0 0 6px">Help request: ${esc(h.topic)}</h2>
    <table style="border-collapse:collapse;margin:12px 0">
      ${row("From", esc(h.name) + " &middot; " + esc(who))}
      ${h.email ? row("Email", `<a href="mailto:${esc(h.email)}">${esc(h.email)}</a>`) : ""}
      ${phone ? row("Phone", phone) : ""}
      ${wants ? row("Prefers", esc(wants)) : ""}
      ${row("Sent", esc(new Date(h.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })))}
    </table>
    <div style="white-space:pre-wrap;background:#f4f6f8;border-radius:8px;padding:12px 14px;line-height:1.5">${esc(h.message)}</div>
    <p style="color:#5c6b7a;font-size:13px;margin-top:16px">Mark it as handled on the Admin page, Help Requests tab: https://newberngrand.com/admin.html#requests</p>
  </div>`;
  const from = Deno.env.get("MAIL_FROM") ?? Deno.env.get("RESET_FROM") ?? "New Bern Grand Marina <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `Help request from ${h.name || who}: ${h.topic}`, html, ...(h.email ? { reply_to: h.email } : {}) }),
  });
  if (!r.ok) {
    await db.from("help_requests").update({ notified_at: null }).eq("id", id);
    const t = await r.text();
    console.log("help-email failed", id, r.status, t);
    return json(502, { error: `${r.status} ${t}` });
  }
  return json(200, { sent: to.length });
});
