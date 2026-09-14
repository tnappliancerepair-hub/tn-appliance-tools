// payment-email-watch — emails the office on EVERY payment, from EITHER system.
//
// The problem (Teddy, 2026-06-29): "we're having a hard time knowing when things are being
// paid for, including cash jobs." Payments fire a 💵 SMS siren that gets buried. This emails
// a receipt the moment a new payment lands.
//
// ⚠️ THERE IS NO SINGLE CANONICAL PAYMENT EVENT, and there is no single DATABASE either:
//   • Xano  `customer_payment_received`  — Stripe: quick-check $50/$100, add-ons, invoices
//   • Xano  `payment_recorded_offline`   — cash/check/Zelle recorded on the LEGACY surfaces
//   • Supabase `invoice` (status='paid') — EVERY payment on the PLATFORM board: the tech's
//     "Mark collected" and all three office-board write sites. The crew cut over to the
//     platform 2026-09-13, so this is where the real money now lands.
// This watcher reads ALL THREE. It used to read one, which is why Jimmy's $55 cash never
// emailed even though he recorded it correctly (Danielle, 2026-09-14).
//
// Dedup by row id so each payment emails once. Built on the SES send-email primitive.
//
//   payment-email-watch-cron       scheduled — the live run
//   GET ?dry=1[&days=3]            list recent payments, send nothing
//   GET ?test=1                    send one test email, bypassing dedup
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const platform = require('./_lib/platform-db');
const { getSecret } = require('./_lib/secrets');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const TO = process.env.PAYMENT_EMAIL_TO || 'tnappliancerepair@gmail.com';
// Danielle 2026-09-14 asked for EMAIL specifically, and that is the right channel:
// _lib/office-gate suppresses EVERY tag to her cell under Teddy's 2026-08-28
// no-texting-the-office rule, so a text to her is written and delivered NOWHERE.
// CC, not TO, so the dedup ledger + reply-to stay pointed at the owner.
const CC = (process.env.PAYMENT_EMAIL_CC || 'danielle.tnappliance@gmail.com')
  .split(',').map((x) => x.trim()).filter(Boolean);
// TN's tenant on the multi-tenant platform. Scoped on purpose — the demo tenant carries
// its own paid invoices, and an unscoped read would email Joey's demo money as TN's.
const TN_COMPANY = process.env.PLATFORM_TN_COMPANY_ID || 'be4d11a1-5219-469b-916a-ab990be7ea7f';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ctTime(ms) { if (!ms) return ''; try { return new Date(Number(ms)).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };

// money(amount, unit) — 'cents' and 'dollars' are EXACT. 'guess' is the legacy heuristic and
// exists only because old Stripe rows are inconsistent about which one they stored. Never
// guess on a row whose unit we actually know: a $1,200 cash collect guessed as cents renders
// $12.00, and a $5.00 platform invoice guessed as dollars renders $500.00. Both are wrong in
// the direction that costs money.
function toDollars(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (unit === 'cents') return n / 100;
  if (unit === 'dollars') return n;
  return n >= 1000 ? n / 100 : n;                       // legacy Stripe rows only
}
function money(amount, unit) {
  const d = toDollars(amount, unit);
  return d === null ? `$${amount}` : `$${d.toFixed(2)}`;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};

  // ⚠️ GATE. This used to be a scheduled function, and Netlify's edge-403 on scheduled
  // functions was its ONLY protection -- which also made ?dry=1 unreachable, so a money
  // watcher could never be eyeballed before it sent. The schedule now lives on the thin
  // payment-email-watch-cron wrapper and the logic is callable here, so it needs a real
  // gate: this reads payment data and can send email. Scheduled runs (if a schedule is
  // ever re-added) self-authorize via the {next_run} body, same as the other watchers.
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const dry = q.dry === '1';
  const days = Math.max(1, Math.min(14, parseInt(q.days, 10) || 3));
  const sinceMs = Date.now() - days * 86400000;

  // ?test=1 — send one confirmation email right now, bypassing dedup. Proves the live pipe
  // end-to-end without waiting on a new payment.
  if (q.test === '1') {
    const subject = '✅ Email test — TN Appliance payment alerts are LIVE';
    const body = 'If you can read this in ' + TO + ', payment-tracking emails are working.\n\nFrom now on every payment (quick-check, in-home, Stripe add-ons, and cash collected on the platform) emails you here.\n\nSent ' + ctTime(Date.now()) + ' CT.';
    let t = { ok: false };
    try {
      const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
        body: JSON.stringify({ to: TO, cc: CC, subject, body }), signal: AbortSignal.timeout(15000),
      });
      t = await r.json().catch(() => ({ ok: false }));
    } catch (e) { t = { ok: false, error: String(e.message || e) }; }
    return json(200, { ok: true, test: true, to: TO, cc: CC, email: t, note: t && t.mode === 'live' ? 'SENT live — check the inbox' : (t && t.mode === 'dry-run' ? 'dry-run — EMAIL_ENABLED is OFF' : 'send failed') });
  }

  const pays = [];

  // ── 1 · XANO event_log (Stripe + the legacy cash surfaces) ────────────────
  const ACTIONS = ['customer_payment_received', 'payment_recorded_offline'];
  for (const action of ACTIONS) {
    let got = [];
    try { got = await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 200) || []; }
    catch (e) { return json(200, { ok: false, error: String(e.message || e), failed_action: action }); }
    for (const r of got) {
      const created = Number(r.created_at || 0);
      if (created && created < sinceMs) continue;
      const m = meta(r);
      // An offline row is a DIFFERENT shape: {job_id, amount, method, reference, notes,
      // recorded_by} — no kind, no pay_method, no at_ms. Reading it with the Stripe keys
      // gave a blank method and a useless "payment" label.
      const offline = action === 'payment_recorded_offline';
      pays.push({
        id: String(r.id),
        src: 'xano',
        cash: offline,
        // record_payment_received takes a parseFloat off the tech's phone, so an offline
        // amount is ALWAYS whole dollars. Stripe rows stay on the legacy guess.
        amount: m.amount, unit: offline ? 'dollars' : 'guess',
        kind: offline ? (m.method || 'cash') : (m.kind || m.source || 'payment'),
        method: offline ? (m.method || '') : (m.pay_method || m.source || ''),
        who: offline ? (TECHS[parseInt(m.recorded_by, 10)] || '') : '',
        customer: '', unit_label: '',
        job_id: m.job_id || null,
        link: m.job_id ? `${SITE}/office-board.html?job=${m.job_id}` : '',
        ts: Number(m.at_ms || r.created_at) || 0,
      });
    }
  }

  // ── 2 · PLATFORM Supabase invoice (where the crew's money actually lands) ──
  // A failed read must NEVER look like "no payments" — that is the whole bug being fixed.
  let platErr = '';
  try {
    const p = await platform.recentPaidInvoices({ companyId: TN_COMPANY, sinceMs, limit: 100 });
    if (!p.ok) platErr = p.error || 'unknown';
    for (const v of (p.rows || [])) {
      const isCash = /^(cash|check|zelle|venmo|cashapp)$/i.test(v.method || '');
      pays.push({
        id: 'p:' + v.id,                                // UUID — never collides with a Xano int id
        src: 'platform',
        cash: isCash,
        amount: v.amount_cents, unit: 'cents',
        kind: v.method || 'payment',
        method: v.method || '',
        who: v.tech || '',
        customer: v.customer || '', unit_label: v.unit || '',
        job_id: v.job_id,
        link: v.job_id ? `${SITE}/platform/office-board.html?job=${v.job_id}` : '',
        ts: v.paid_at_ms || 0,
      });
    }
  } catch (e) { platErr = String(e.message || e); }
  if (platErr) {
    // Durable alarm: a permanently broken money read should be loud and greppable, not a
    // quiet zero. This is the class of failure that hid Jimmy's $55 for a day.
    try { await crud.logEvent('payment_email_platform_read_failed', { error: platErr, at_ms: Date.now() }); } catch (_) {}
  }

  pays.sort((a, b) => b.ts - a.ts);

  // ── dedup — which payment ids have we already emailed? ────────────────────
  // STRING keys throughout: platform ids are UUIDs, and Number(uuid) is NaN, which a Set
  // treats as one single value — that would collapse every platform payment into one slot
  // and email exactly one of them, ever. Historical ledger rows stored ints, and
  // String(101) === "101" either way, so old entries still match.
  const emailed = new Set();
  try {
    const sent = await crud.searchPage(crud.TABLES.event_log, { action: 'payment_email_sent' }, { id: 'desc' }, 80);
    for (const r of sent || []) { for (const id of (meta(r).ids || [])) emailed.add(String(id)); }
  } catch (_) {}

  const fresh = pays.filter((p) => !emailed.has(String(p.id)));
  const out = { ok: true, dry, recent_payments: pays.length, new: fresh.length, sources: { xano: pays.filter((p) => p.src === 'xano').length, platform: pays.filter((p) => p.src === 'platform').length } };
  if (platErr) out.platform_read_error = platErr;

  if (dry) { out.payments = pays.slice(0, 20); return json(200, out); }

  // ⚠️ THE SILENT-BLINDNESS HOLE — the whole lesson of this bug, applied to the fix itself.
  // If the platform read fails AND there are no Xano payments, every earlier version of this
  // code returned a cheerful "no new payments" and said nothing. That is indistinguishable
  // from a quiet day, which is exactly how a money watcher goes dark for a week. So: when we
  // could not SEE the board and have nothing else to report, say so out loud. Deduped to once
  // per 6h so a sustained outage warns rather than spams.
  if (platErr && !fresh.length) {
    let warnedRecently = false;
    try {
      const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'payment_email_blind_alert' }, { id: 'desc' }, 5);
      const newest = Math.max(0, ...((prior || []).map((r) => Number(meta(r).at_ms || r.created_at || 0))));
      warnedRecently = newest > 0 && (Date.now() - newest) < 6 * 3600000;
    } catch (_) {}
    if (!warnedRecently) {
      const subject = '⚠️ Payment alerts are BLIND — cannot read the job board (TN Appliance)';
      const body = 'The payment watcher could not read the platform board this run:\n\n  ' + platErr
        + '\n\nThat means a cash or card payment collected on the board may have been taken WITHOUT'
        + ' anyone being emailed about it. Payments recorded on the legacy system are unaffected.\n\n'
        + 'Check the board directly until this clears: ' + SITE + '/platform/office-board.html\n\n'
        + ctTime(Date.now()) + ' CT';
      try {
        const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
          body: JSON.stringify({ to: TO, cc: CC, subject, body }), signal: AbortSignal.timeout(15000),
        });
        const d = await r.json().catch(() => ({}));
        if (d && d.ok && d.mode === 'live') { try { await crud.logEvent('payment_email_blind_alert', { error: platErr, at_ms: Date.now() }); } catch (_) {} }
        out.blind_alert = d;
      } catch (e) { out.blind_alert = { ok: false, error: String(e.message || e) }; }
    } else { out.blind_alert = 'suppressed — already warned within 6h'; }
  }

  if (!fresh.length) { out.note = platErr ? 'platform read FAILED — nothing else to report' : 'no new payments — no email'; return json(200, out); }

  // Cash leads with 💵 CASH and names who collected it and for whom — that is the whole ask:
  // the office should never learn about collected money because the tech happened to mention it.
  const lineFor = (p) => (p.cash ? '💵 CASH COLLECTED — ' : '') +
    money(p.amount, p.unit) +
    (p.method && p.method !== 'payment' ? ` · ${p.method}` : '') +
    (p.who ? ` · collected by ${p.who}` : '') +
    (p.customer ? ` · ${p.customer}` : '') +
    (p.unit_label ? ` · ${p.unit_label}` : '') +
    (p.ts ? ` · ${ctTime(p.ts)}` : '') +
    (p.link ? `\n    → ${p.link}` : '');

  const total = fresh.reduce((s, p) => s + (toDollars(p.amount, p.unit) || 0), 0);
  const cashN = fresh.filter((p) => p.cash).length;
  const body =
    `${fresh.length} new payment${fresh.length === 1 ? '' : 's'} received ($${total.toFixed(2)} total):\n\n` +
    fresh.map(lineFor).join('\n\n') +
    (platErr ? `\n\n⚠️ Could not read the platform board this run (${platErr}) — a payment collected there may be missing from this list.` : '') +
    `\n\nFull money view: ${SITE}/money.html`;
  const subject = `\u{1F4B5} ${fresh.length} payment${fresh.length === 1 ? '' : 's'} received — $${total.toFixed(2)}`
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

  // ONLY dedup on a real LIVE send. A dry-run (EMAIL_ENABLED off) also returns ok:true, and
  // recording it here "burns" the payment so it never emails once email is turned on —
  // that's the bug that ate the first batch of receipts.
  if (sent && sent.ok && sent.mode === 'live') {
    try { await crud.logEvent('payment_email_sent', { ids: fresh.map((p) => String(p.id)), count: fresh.length, total, mode: sent.mode || 'live', at_ms: Date.now() }); } catch (_) {}
  }
  out.email = sent;
  out.summary = `${fresh.length} new payment(s) · email ${sent && sent.ok ? (sent.mode || 'sent') : 'FAILED'}`;
  return json(200, out);
};
