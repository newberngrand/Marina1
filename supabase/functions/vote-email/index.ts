// Sends the emails for one recorded vote: a receipt to the voter (slip's email
// on file) and a notice to the vote-counting committee (event's vote_notify_email).
// Called by the database right after a vote is inserted, with { event_id, slip }.
// Each email is sent at most once per vote, so repeat calls do nothing.
//
// Secrets: RESEND_API_KEY (required); MAIL_FROM or RESET_FROM for the sender.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const TZ = "America/New_York";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", {
  timeZone: TZ, weekday: "short", month: "long", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});

async function receiptNo(eventId: string, slip: string, castAt: string) {
  const data = new TextEncoder().encode(`${eventId}|${slip}|${castAt}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash.slice(0, 5)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function send(to: string[], subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const from = Deno.env.get("MAIL_FROM") ?? Deno.env.get("RESET_FROM") ?? "New Bern Grand Marina <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return r.ok ? { ok: true } : { ok: false, error: `${r.status} ${await r.text()}` };
}

const wrap = (inner: string) => `<div style="font-family:Arial,sans-serif;color:#1c2733;max-width:560px">${inner}
  <p style="color:#5c6b7a;font-size:12px;margin-top:24px">New Bern Grand Marina &middot; 134 Craven St, New Bern, NC &middot; (252) 638-0318</p></div>`;
const row = (k: string, v: string) =>
  `<tr><td style="padding:6px 12px 6px 0;color:#5c6b7a">${k}</td><td style="padding:6px 0;font-weight:bold">${v}</td></tr>`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let eventId = "", slip = "", voteId = "";
  try {
    const b = await req.json();
    eventId = String(b.event_id ?? "");
    slip = String(b.slip ?? "").toUpperCase();
    voteId = String(b.vote_id ?? "");
  } catch { return json(400, { error: "Invalid request" }); }
  if (!/^[0-9a-f-]{36}$/i.test(eventId) || !/^[A-Z0-9-]{1,20}$/.test(slip)) return json(400, { error: "Invalid request" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Shared cruiser logins can have many votes per ballot, so look the vote up by its id.
  const q = db.from("votes").select("*").eq("event_id", eventId).eq("slip", slip);
  const { data: vote } = await (/^[0-9a-f-]{36}$/i.test(voteId) ? q.eq("id", voteId) : q.is("voter_name", null)).maybeSingle();
  if (!vote) return json(404, { error: "No such vote" });
  const [{ data: ev }, { data: member }, { data: caster }] = await Promise.all([
    db.from("events").select("title, vote_closes_at, vote_notify_email, ballot_kind, ballot_options, audience").eq("id", eventId).maybeSingle(),
    db.from("members").select("owner_name, email").eq("slip", slip).maybeSingle(),
    db.from("members").select("slip, owner_name").eq("user_id", vote.cast_by).maybeSingle(),
  ]);
  if (!ev) return json(404, { error: "No such event" });

  const receipt = await receiptNo(eventId, slip, vote.cast_at);
  const castBy = caster && caster.slip !== slip ? `${caster.slip} (${caster.owner_name})` : "";
  const result: Record<string, unknown> = { receipt };
  // On a cruiser poll the voter is a named person on a shared login, and there is no fixed list of voters.
  const named = vote.voter_name ? esc(vote.voter_name) + " &middot; " + esc(slip) + " login" : "";
  const voterLabel = named || esc(slip) + (member?.owner_name ? " &middot; " + esc(member.owner_name) : "");

  // 1) Receipt to the voter.
  const voterEmail = (member?.email ?? "").trim();
  if (voterEmail && !vote.receipt_sent_at) {
    const { data: claimed } = await db.from("votes").update({ receipt_sent_at: new Date().toISOString() })
      .eq("id", vote.id).is("receipt_sent_at", null).select("slip");
    if (claimed?.length) {
      const html = wrap(`
        <h2 style="color:#0b2540;margin:0 0 6px">Your vote has been recorded</h2>
        <p>Thank you for voting. This is your receipt; please keep it for your records.</p>
        <table style="border-collapse:collapse;margin:12px 0">
          ${row("Ballot", esc(ev.title))}
          ${row(named ? "Voter" : "Slip", voterLabel)}
          ${row("Your vote", esc(vote.choice))}
          ${row("Recorded", esc(when(vote.cast_at)))}
          ${castBy ? row("Cast from login", esc(castBy)) : ""}
          ${row("Receipt no.", esc(receipt))}
        </table>
        <p style="color:#5c6b7a;font-size:13px">Votes are final and can't be changed. If you did not cast this vote, please contact the marina office right away.</p>`);
      const r = await send([voterEmail], `Vote receipt: ${ev.title} (slip ${slip})`, html);
      result.receipt_email = r;
      if (!r.ok) await db.from("votes").update({ receipt_sent_at: null }).eq("id", vote.id);
    }
  } else if (!voterEmail) {
    result.receipt_email = { ok: false, error: "no email on file for slip" };
  }

  // 2) Notice to the vote-counting committee, with the running tally.
  const committee = (ev.vote_notify_email ?? "").split(/[,;\s]+/).map((x: string) => x.trim()).filter((x: string) => x.includes("@"));
  if (committee.length && !vote.committee_sent_at) {
    const { data: claimed } = await db.from("votes").update({ committee_sent_at: new Date().toISOString() })
      .eq("id", vote.id).is("committee_sent_at", null).select("slip");
    if (claimed?.length) {
      const { data: tally } = await db.rpc("vote_totals_internal", { p_event_id: eventId });
      const rows = (tally ?? []) as { choice: string; votes: number; eligible: number; cast_total: number }[];
      const cast = rows[0]?.cast_total ?? 0, eligible = rows[0]?.eligible ?? 0;
      const pc = (n: number, d: number) => d ? Math.round(n * 1000 / d) / 10 : 0;
      // Ballots that include cruisers (voting by name) have no fixed voter list: show shares of votes cast.
      const byName = ((ev.audience ?? []) as string[]).some((a) => a !== "certificated");
      const tallyRows = eligible && !byName
        ? rows.map((t) => row(esc(t.choice), `${t.votes} (${pc(t.votes, eligible)}% of eligible slips)`)).join("") +
          row("Voted", `${cast} of ${eligible} eligible slips (${pc(cast, eligible)}%)`)
        : rows.map((t) => row(esc(t.choice), `${t.votes} (${pc(t.votes, cast)}% of votes cast)`)).join("") +
          row("Votes cast", String(cast));
      const html = wrap(`
        <h2 style="color:#0b2540;margin:0 0 6px">Vote received: ${esc(ev.title)}</h2>
        <table style="border-collapse:collapse;margin:12px 0">
          ${row(named ? "Voter" : "Slip", voterLabel)}
          ${row("Vote", esc(vote.choice))}
          ${row("Recorded", esc(when(vote.cast_at)))}
          ${castBy ? row("Cast from login", esc(castBy)) : ""}
          ${row("Receipt no.", esc(receipt))}
          ${named ? "" : row("Voter receipt", voterEmail ? "emailed to " + esc(voterEmail) : "<span style='color:#b3392f'>no email on file</span>")}
        </table>
        <h3 style="color:#0b2540;margin:18px 0 6px">Running total</h3>
        <table style="border-collapse:collapse">
          ${tallyRows}
        </table>
        <p style="color:#5c6b7a;font-size:13px">Voting closes ${esc(when(ev.vote_closes_at))}. The full slip-by-slip list is on the Admin page (Results).</p>`);
      const r = await send(committee, `Vote received: ${ev.title} - ${vote.voter_name ? vote.voter_name + " (" + slip + ")" : "slip " + slip}`, html);
      result.committee_email = r;
      if (!r.ok) await db.from("votes").update({ committee_sent_at: null }).eq("id", vote.id);
    }
  }

  if (!(result.receipt_email as { ok?: boolean })?.ok || (committee.length && !(result.committee_email as { ok?: boolean })?.ok)) {
    console.log("vote-email", eventId, slip, JSON.stringify(result));
  }
  return json(200, result);
});
