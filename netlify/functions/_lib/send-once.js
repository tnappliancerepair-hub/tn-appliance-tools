// send-once — claim a customer-facing send BEFORE it goes out, so a double-text is
// impossible rather than unlikely.
//
// THE BUG THIS EXISTS FOR (measured 2026-09-10): the day-before reminder texted 17 customers
// twice on 09-07. The dedupe read a marker, SENT, then wrote the marker. That is airtight for
// two runs in a row and worthless for two runs at once -- both read "not sent", both text, and
// the race window is the whole SMS round trip. The same shape lived in the review sweep (the
// cron AND the manual star button both write the ask) and in every arrived / complete /
// on-my-way tap a thumb can hit twice.
//
// So the order inverts: WRITE THE CLAIM FIRST, and let the DATABASE settle who owns the send.
// A partial unique index on thread_message (company_id, send_key) refuses the second claim
// (PostgREST answers 409), the loser returns false, and only the winner texts.
//
//   const key = onceKey('review', jobId);              // once ever for this job
//   const key = dailyKey('arrived', jobId);            // once per calendar day (CT)
//   if (!(await claimSend(base, H, row, key))) return; // someone else owns it -- do not text
//
// FAILS CLOSED on purpose. If the claim cannot be confirmed -- network blip, timeout, anything
// -- we do NOT send. A missed message is silent and recoverable; a duplicate lands on a real
// customer's phone and cannot be taken back. That trade is the standing rule for every
// customer-facing send on this platform.
//
// A row with NO key is unconstrained, so free-form office/tech replies still repeat freely.
'use strict';

// Calendar day in Central time -- the day the customer is actually living in, not UTC's.
function ctDate(d) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d || new Date());
  } catch (_) { return new Date().toISOString().slice(0, 10); }
}

// once ever, for this job: 'review:<job_id>'
function onceKey(kind, jobId) { return String(kind) + ':' + String(jobId); }
// once per CT day: 'arrived:<job_id>:2026-09-10' -- a return trip on another day is allowed.
function dailyKey(kind, jobId, when) { return onceKey(kind, jobId) + ':' + ctDate(when); }

// Insert the claim. true = we own this send. false = somebody else does, or we could not
// confirm -- either way, do not text.
async function claimSend(base, H, row, key, timeoutMs) {
  if (!key) return false;
  try {
    const r = await fetch(String(base).replace(/\/+$/, '') + '/rest/v1/thread_message', {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({ ...row, send_key: key }),
      signal: AbortSignal.timeout(timeoutMs || 9000),
    });
    if (r.status === 409) return false;            // the index refused it -- another run owns the send
    if (!r.ok) return false;                       // fail closed
    const d = await r.json().catch(() => null);
    return Array.isArray(d) ? d.length > 0 : !!d;  // only a row that actually landed counts
  } catch (_) { return false; }
}

module.exports = { claimSend, onceKey, dailyKey, ctDate };
