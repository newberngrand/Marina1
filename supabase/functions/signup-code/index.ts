// Emails a 6-digit code so someone on a shared login (LTC / STC / staff) can
// change or cancel their own sign-up. { event_id, email } with the member's
// login token. The database checks the login, the event and that a sign-up on
// this login uses that email; it stores only a hash of the code (30 minutes).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return reply(401, { error: "Please log in again." });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(400, { error: "Invalid request" }); }
  const eventId = String(b.event_id ?? ""), email = String(b.email ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return reply(400, { error: "Invalid request" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "Please enter the email address you used when you signed up." });

  const { data: code, error } = await db.rpc("signup_code_issue", { p_uid: caller.user.id, p_event_id: eventId, p_email: email });
  if (error || !code) return reply(400, { error: error?.message ?? "Could not create a code." });

  const { data: ev } = await db.from("events").select("title").eq("id", eventId).maybeSingle();
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return reply(500, { error: "Email isn't set up." });
  const from = Deno.env.get("MAIL_FROM") ?? Deno.env.get("RESET_FROM") ?? "New Bern Grand Marina <onboarding@resend.dev>";
  const html = `<div style="font-family:Arial,sans-serif;color:#1c2733;max-width:560px">
    <h2 style="color:#0b2540;margin:0 0 8px">Your code to change your sign-up</h2>
    <p>Someone asked to change or cancel a sign-up for <strong>${esc(ev?.title ?? "an event")}</strong> that uses this email address.</p>
    <p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#0b2540;margin:18px 0">${code}</p>
    <p>Type this code on the event page. It works for 30 minutes.</p>
    <p style="color:#5c6b7a;font-size:13px">If you didn't ask for this, you can ignore this email; nothing has been changed.</p>
    <p style="color:#5c6b7a;font-size:12px;margin-top:24px">New Bern Grand Marina &middot; 134 Craven St, New Bern, NC &middot; (252) 638-0318</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject: `Your sign-up code: ${code}`, html }),
  });
  if (!r.ok) {
    console.log("signup-code send failed", r.status, await r.text());
    return reply(502, { error: "The code email couldn't be sent right now. Please try again later or call the marina office." });
  }
  return reply(200, { ok: true, message: `We emailed a 6-digit code to ${email}. It works for 30 minutes.` });
});
