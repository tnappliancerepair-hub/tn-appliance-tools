// payment-email-watch — emails tnappliancerepair@gmail.com on EVERY payment.
//
// The problem (Teddy, 2026-06-29): "we're having a hard time knowing when things
// are being paid for, including cash jobs." Payments fire a 💵 SMS siren that gets
// buried. This emails a payment receipt the moment a new payment lands — covering
// ALL sources, because every payment (quick-check $50/$100, Stripe add-ons/invoice,
// in-home) writes `customer_payment_received`, and cash/check/Zelle/Venmo recorded in the
// field or by the office writes `payment_recorded_offline`. There is NO single canonical
// payment event -- this watcher reads BOTH. (It used to claim there was one and watch only
// the Stripe half, so cash never emailed: Danielle, 2026-09-14.)
//
// Dedup by event id so each payment emails once. Built on the SES send-email
// primitive → DORMANT until email is turned on (EMAIL_ENABLED=true + SES verify);
// dry-runs safely until then. ?dry=1 lists recent payments (no email) — use it to
// answer "did that payment come through?".
//
//   scheduled every 30 min   email a receipt when a new payment lands
//   GET ?dry=1[&days=3]      list recent payments, send nothing
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const TO = process.env.PAYMENT_EMAIL_TO || 'tnappliancerepair@gmail.com';
// Danielle 2026-09-14: "Cash payments are not sending me a email on it. Jimmy collected
// 55 cash and wouldn't know if he didn't tell me." She asked for EMAIL specifically and
// that is the right channel -- office-gate suppresses EVERY tag to her cell (Teddy's
// 2026-08-28 no-texting-the-office rule), so a text to her is written and delivered
// NOWHERE. CC, not TO, so the dedup ledger + reply-to stay pointed at the owner.
const CC = (process.env.PAYMENT_EMAIL_CC || 'danielle.tnappliance@gmail.com')
  .split(',').map((x) => x.trim()).filter(Boolean);

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ctTime(ms) { if (!ms) return ''; try { return new Date(Number(ms)).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
// money(): legacy Stripe rows are inconsistent about cents-vs-dollars, hence the magnitude
// guess. Pass isDollars=true for a row we KNOW is dollars (offline/cash) so a $1,200 cash
// collection cannot render as $12.00.
const money = (a, isDollars) => { const n = Number(a); if (!Number.isFinite(n)) return `$${a}`; if (isDollars) return `$${n.toFixed(2)}`; return n >= 1000 ? `$${(n / 100).toFixed(2)}` : `$${n.toFixed(2)}`; };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dry === '1';
  const days = Math.max(1, Math.min(14, parseInt(q.days, 10) || 3));
  const sinceMs = Date.now() - days * 86400000;

  // ?test=1 — send one confirmation email to TO right now, bypassing dedup. Proves
  // the live pipe end-to-end without waiting on a new payment.
  if (q.test === '1') {
    const subject = '✅ Email test — TN Appliance payment alerts are LIVE';
    const body = 'If you can read this in ' + TO + ', payment-tracking emails are working.\n\nFrom now on every payment (quick-check, in-home, Stripe add-ons, cash) emails you here.\n\nSent ' + ctTime(Date.now()) + ' CT.';
    let t = { ok: false };
    try {
      const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
        body: JSON.stringify({ to: TO, cc: CC, subject, body }), signal: AbortSignal.timeout(15000),
      });
      t = await r.json().catch(() => ({ ok: false }));
    } catch (e) { t = { ok: false, error: String(e.message || e) }; }
    return json(200, { ok: true, test: true, to: TO, email: t, note: t && t.mode === 'live' ? 'SENT live — check the inbox' : (t && t.mode === 'dry-run' ? 'dry-run — EMAIL_ENABLED is OFF' : 'send failed') });
  }

  // ⚠️ THE BUG Danielle found: this watched ONE action and the header above claimed every
  // payment "including cash/check" writes it. That was FALSE. A tech tapping the cash button
  // on tech-job.html hits record_payment_received, which writes `payment_recorded_offline`
  // -- so cash could never email, no matter how many times it was collected. Same dead-signal
  // class as tech_job_complete and the never-allowlisted cash_ready_notify tags: a watcher
  // keyed on an action nothing emits looks perfectly healthy and reports zero forever.
  // Read BOTH. Event ids are the event_log PK, so the merge cannot collide or double-send.
  const ACTIONS = ['customer_payment_received', 'payment_recorded_offline'];
  let rows = [];
  for (const action of ACTIONS) {
    try {
      const got = await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 200) || [];
      rows = rows.concat(got.map((r) => Object.assign({}, r, { _action: action })));
    }
    catch (e) { return json(200, { ok: false, error: String(e.message || e), failed_action: action }); }
  }

  // recent window
  const pays = (rows || []).filter((r) => { const c = Number(r.created_at || 0); return !c || c >= sinceMs; }).map((r) => {
    const m = meta(r);
    // An offline row is a DIFFERENT shape: {job_id, amount, method, reference, notes,
    // recorded_by} -- no kind, no pay_method, no at_ms. Reading it with the Stripe keys
    // gave a blank method and a useless "payment" label, which is half of why cash was
    // invisible even where it did land.
    const offline = r._action === 'payment_recorded_offline';
    return {
      id: r.id,
      amount: m.amount,
      // record_payment_received takes a parseFloat from the tech's phone, so an offline
      // amount is ALWAYS whole dollars. Say so, because money() below otherwise guesses
      // cents-vs-dollars by magnitude and would render $1,200 cash as $12.00.
      dollars: offline,
      offline,
      kind: offline ? (m.method || 'cash') : (m.kind || m.source || 'payment'),
      job_id: m.job_id || null,
      method: offline ? (m.method || '') : (m.pay_method || m.source || ''),
      by: offline ? TECHS[parseInt(m.recorded_by, 10)] || '' : '',
      session: m.session_id || '', at: ctTime(m.at_ms || r.created_at),
    };
  }).sort((a, b) => Number(b.id) - Number(a.id));

  // dedup — which payment event ids have we already emailed?
  const emailed = new Set();
  try {
    const sent = await crud.searchPage(crud.TABLES.event_log, { action: 'payment_email_sent' }, { id: 'desc' }, 80);
    for (const r of sent || []) { for (const id of (meta(r).ids || [])) emailed.add(Number(id)); }
  } catch (_) {}

  const fresh = pays.filter((p) => !emailed.has(Number(p.id)));
  const out = { ok: true, dry, recent_payments: pays.length, new: fresh.length };

  if (dry) { out.payments = pays.slice(0, 20); return json(200, out); }
  if (!fresh.length) { out.note = 'no new payments — no email'; return json(200, out); }

  // Cash leads with 💵 CASH and names who collected it -- that is the whole ask: the office
  // should never learn about collected money because the tech happened to mention it.
  const lineFor = (p) => (p.offline ? '💵 CASH COLLECTED — ' : '') +
    `${money(p.amount, p.dollars)} · ${p.kind}${p.job_id ? ' · job #' + p.job_id : ''}` +
    `${p.method && p.method !== p.kind ? ' · ' + p.method : ''}` +
    `${p.by ? ' · collected by ' + p.by : ''} · ${p.at}` +
    `${p.job_id ? '  →  ' + SITE + '/office-board.html?job=' + p.job_id : ''}`;
  const total = fresh.reduce((s, p) => { const n = Number(p.amount) || 0; return s + (p.dollars ? n : (n >= 1000 ? n / 100 : n)); }, 0);
  const body =
    `${fresh.length} new payment${fresh.length === 1 ? '' : 's'} received (${money(total)} total):\n\n` +
    fresh.map(lineFor).join('\n') +
    `\n\nFull money view: ${SITE}/money.html`;
  const cashN = fresh.filter((p) => p.offline).length;
  const subject = `\u{1F4B5} ${fresh.length} payment${fresh.length === 1 ? '' : 's'} received — ${money(total, true)}`
    + (cashN ? ` (${cashN} CASH)` : '') + ' (TN Appliance)';

  let sent = { ok: false };
  try {
    const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
      body: JSON.stringify({ to: TO, cc: CC, subject, body }),
      signal: AbortSignal.timeout(15000),
    });
    sent = await r.json().catch(() => ({ ok: false }));
  } catch (e) { sent = { ok: false, error: String(e.message || e) }; }

  // ONLY dedup on a real LIVE send. A dry-run (EMAIL_ENABLED off) also returns
  // ok:true, and recording it here "burns" the payment so it never emails once
  // email is turned on — that's the bug that ate the first batch of receipts.
  if (sent && sent.ok && sent.mode === 'live') {
    try { await crud.logEvent('payment_email_sent', { ids: fresh.map((p) => Number(p.id)), count: fresh.length, total, mode: sent.mode || 'live', at_ms: Date.now() }); } catch (_) {}
  }
  out.email = sent;
  out.summary = `${fresh.length} new payment(s) · email ${sent && sent.ok ? (sent.mode || 'sent') : 'FAILED'}`;
  return json(200, out);
};
