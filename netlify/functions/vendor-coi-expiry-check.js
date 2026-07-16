// vendor-coi-expiry-check — texts Teddy when the Certificate of Insurance is within 30 days
// of expiring (or already expired), so a PM never gets handed an expired COI (an instant
// vendor rejection). Reads the coi_expires date from the vendor_docs_config. Weekly cron.
//   GET ?secret=<admin>   (manual)   ·   scheduled (cron) self-authorizes
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');
const OWNER = '+16154855795';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  }

  let cfg = {};
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'vendor_docs_config' }, { id: 'desc' });
    let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    cfg = m || {};
  } catch (_) { return json(200, { ok: false, error: 'config read failed' }); }

  const exp = String(cfg.coi_expires || '').trim(); // YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return json(200, { ok: true, skipped: 'no_expiry_set' });

  const now = Date.now();
  const expMs = new Date(exp + 'T12:00:00Z').getTime();
  const days = Math.round((expMs - now) / 86400000);

  let alert = null;
  if (days < 0) alert = '🛡️⛔ TN Appliance COI EXPIRED ' + Math.abs(days) + ' days ago (' + exp + '). Renew it NOW — an expired certificate gets you rejected by every PM. Upload the new one at /vendor-docs-admin.html';
  else if (days <= 30) alert = '🛡️⚠️ TN Appliance COI expires in ' + days + ' days (' + exp + '). Get the renewed ACORD from Hiscox and upload it at /vendor-docs-admin.html before it lapses.';

  if (alert) { try { await sendSms(OWNER, '[ant] ' + alert, 'owner', 'vendor_coi_expiry'); } catch (_) {} }
  return json(200, { ok: true, coi_expires: exp, days_until: days, alerted: !!alert });
};
