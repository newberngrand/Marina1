// Password reset for slip logins.
// The visitor sends { slip, email }. If the email matches the contact email
// stored for that slip, a one-time reset link is emailed to that address.
// The response is always the same, so it never reveals whether a slip or
// email is on file.
//
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   RESEND_API_KEY  API key for sending email through Resend (resend.com)
//   RESET_FROM      Sender, e.g. "New Bern Grand Marina <noreply@newberngrand.com>"
//   SITE_URL        Optional, defaults to https://newberngrand.github.io/Marina1
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_PER_HOUR = 3;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const generic = {
    ok: true,
    message: "If that slip and email match our records, a reset link is on its way to that email address.",
  };

  let slip = "", email = "";
  try {
    const body = await req.json();
    slip = String(body.slip ?? "").trim().toUpperCase();
    email = String(body.email ?? "").trim().toLowerCase();
  } catch {
    return reply(400, { error: "Invalid request" });
  }
  if (!/^[A-Z0-9-]{1,20}$/.test(slip) || !email.includes("@") || email.length > 254) {
    return reply(400, { error: "Please enter your slip and email address." });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("password_reset_requests")
    .select("id", { count: "exact", head: true })
    .eq("slip", slip)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_HOUR) return reply(200, generic);

  const { data: member } = await admin
    .from("members")
    .select("slip, owner_name, email, active")
    .eq("slip", slip)
    .maybeSingle();

  const matched = !!member && member.active && !!member.email &&
    member.email.trim().toLowerCase() === email;
  await admin.from("password_reset_requests").insert({ slip, matched });
  if (!matched) return reply(200, generic);

  const authEmail = `slip-${slip.toLowerCase()}@members.newberngrand.com`;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: authEmail,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error("generateLink failed", slip, linkErr?.message);
    return reply(200, generic);
  }

  const site = (Deno.env.get("SITE_URL") ?? "https://newberngrand.github.io/Marina1").replace(/\/$/, "");
  const resetUrl = `${site}/reset-password.html?token_hash=${encodeURIComponent(link.properties.hashed_token)}&slip=${encodeURIComponent(slip)}`;

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESET_FROM") ?? "New Bern Grand Marina <onboarding@resend.dev>";
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set; reset email not sent for slip", slip);
    return reply(200, generic);
  }

  const name = escapeHtml(member!.owner_name || "Member");
  const html = `
    <p>Hello ${name},</p>
    <p>We received a request to reset the New Bern Grand Marina member password for slip <strong>${escapeHtml(slip)}</strong>.</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#0b2a4a;color:#fff;text-decoration:none;border-radius:6px">Choose a new password</a></p>
    <p>This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password won't change.</p>
    <p>New Bern Grand Marina<br>(252) 638-0318</p>`;

  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [member!.email!.trim()],
      subject: `Password reset for slip ${slip}`,
      html,
    }),
  });
  if (!send.ok) console.error("Resend failed", send.status, await send.text());

  return reply(200, generic);
});
