// Admin-only member tools that need server privileges:
//   { action: "set_password", slip, password }
//   { action: "create_slip", slip, owner_name, email, password, can_vote }
// The caller must be signed in with an active admin account.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const slipEmail = (slip: string) => `slip-${slip.toLowerCase()}@members.newberngrand.com`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return reply(401, { error: "Please log in again." });
  const { data: me } = await admin.from("members").select("slip, is_admin, active").eq("user_id", caller.user.id).maybeSingle();
  if (!me?.is_admin || !me.active) return reply(403, { error: "Only board administrators can do this." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Invalid request" }); }
  const action = String(body.action ?? "");
  const slip = String(body.slip ?? "").trim().toUpperCase();
  const password = String(body.password ?? "");
  if (!/^[A-Z0-9-]{1,20}$/.test(slip)) return reply(400, { error: "Please enter a valid slip (letters, numbers and dashes)." });
  if (password && password.length < 8) return reply(400, { error: "Passwords must be at least 8 characters." });

  if (action === "set_password") {
    if (!password) return reply(400, { error: "Please enter the new password." });
    const { data: m } = await admin.from("members").select("user_id").eq("slip", slip).maybeSingle();
    if (!m?.user_id) return reply(404, { error: `Slip ${slip} has no login account.` });
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { password });
    if (error) return reply(400, { error: error.message });
    console.log(`password set for slip ${slip} by ${me.slip}`);
    return reply(200, { ok: true, message: `Password updated for slip ${slip}.` });
  }

  if (action === "create_slip") {
    if (!password) return reply(400, { error: "Please set a starting password for the new slip." });
    const owner = String(body.owner_name ?? "").trim();
    const email = String(body.email ?? "").trim() || null;
    if (!owner) return reply(400, { error: "Please enter the owner's name." });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "That email address doesn't look right." });
    const { data: exists } = await admin.from("members").select("slip").eq("slip", slip).maybeSingle();
    if (exists) return reply(409, { error: `Slip ${slip} already exists.` });

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: slipEmail(slip), password, email_confirm: true, user_metadata: { slip },
    });
    if (cErr || !created?.user) return reply(400, { error: cErr?.message ?? "Could not create the login." });
    const { error: mErr } = await admin.from("members").insert({
      slip, user_id: created.user.id, owner_name: owner, email, can_vote: body.can_vote !== false,
    });
    if (mErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return reply(400, { error: mErr.message });
    }
    console.log(`slip ${slip} created by ${me.slip}`);
    return reply(200, { ok: true, message: `Slip ${slip} added.` });
  }

  return reply(400, { error: "Unknown action" });
});
