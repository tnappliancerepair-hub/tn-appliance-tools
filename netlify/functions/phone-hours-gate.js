// phone-hours-gate — the automatic on/off switch for LIVE human transfers.
// Ann answers 24/7, but a caller is connected to a real person (tech, Danielle,
// or the office ring) ONLY Mon–Fri 9 AM–6 PM Central. This cron re-runs the
// wiretechs sync on a tight cadence; wiretechs itself is hours-aware, so it
// ADDS the transferCall tool at 9 AM and REMOVES it at 6 PM (and all weekend).
// Off-hours Ann has no transfer capability at all — she can only take a message.
// That's the hard guarantee: no prompt rule to slip, the phone physically can't
// ring a human before 9 or after 6.
//
// Scheduled every 15 min (see netlify.toml). Self-authorizes on {next_run};
// manual run needs ?secret=. Kill switch: vault PHONE_HOURS_GATE=false.
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const off = String((await getSecretFresh('PHONE_HOURS_GATE')) || '').trim().toLowerCase() === 'false';
  if (off) return json(200, { ok: true, disabled: true });

  // Re-run wiretechs — it computes business hours itself and wires/unwires the
  // transferCall tool accordingly. Idempotent; safe to run every 15 min.
  try {
    const r = await fetch(`${SITE}/.netlify/functions/vapi-admin?action=wiretechs&secret=${encodeURIComponent(admin)}`);
    const d = await r.json().catch(() => ({}));
    return json(200, { ok: !!d.ok, open: d.business_hours_open, transfer_enabled: d.transfer_enabled, note: d.note });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
