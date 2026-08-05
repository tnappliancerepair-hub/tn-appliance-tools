// fedex-returns-autoclose — ticks the returns pile down by itself. Pulls the OPEN
// returns that carry a FedEx tracking #, asks FedEx if each was delivered (to the
// distributor), and for the delivered ones records the return as shipped/closed WITH
// the FedEx delivery proof (date + status) — the chargeback shield, captured
// automatically instead of a human tapping "Shipped ✓". (Teddy 2026-08-05: FedEx API
// vaulted; the 230-open backlog was really "nobody taps shipped".)
//
//   SHADOW (default): reports which open returns FedEx says are delivered + would close.
//     Closes NOTHING. Flip vault FEDEX_AUTOCLOSE_LIVE=true to auto-close for real.
//   GET ?secret=<admin>[&dry=1]   manual run   ·   scheduled runs self-authorize.
'use strict';
const fedex = require('./_lib/fedex');
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { loadOpenReturns } = require('./_lib/returns');
const crud = require('./_lib/xano/metadata-crud');

// Give it headroom past Netlify's default — several FedEx track batches + event reads.
exports.config = { timeout: 26 };

const MAX_TRACK = 120; // cap per run (4 batches of 30) so we never blow the timeout;
                       // the twice-daily cron works the rest as closed ones drop off.
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Parse the FedEx Track v1 response -> { trackingNumber: {delivered, status, deliveredAt} }
function parseTrack(d) {
  const out = {};
  const results = (d && d.output && d.output.completeTrackResults) || [];
  for (const c of results) {
    const tn = String(c.trackingNumber || '').trim();
    const tr = (c.trackResults && c.trackResults[0]) || {};
    const code = String((tr.latestStatusDetail && tr.latestStatusDetail.code) || '').toUpperCase();
    const desc = (tr.latestStatusDetail && (tr.latestStatusDetail.statusByLocale || tr.latestStatusDetail.description)) || '';
    let deliveredAt = '';
    for (const dt of (tr.dateAndTimes || [])) { if (String(dt.type || '').toUpperCase() === 'ACTUAL_DELIVERY') deliveredAt = dt.dateTime || ''; }
    const delivered = code === 'DL' || /delivered/i.test(String(desc));
    if (tn) out[tn] = { delivered, status: desc || code, deliveredAt, code };
  }
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!(await fedex.configured())) return json(200, { ok: false, error: 'fedex not configured — vault FEDEX_CLIENT_ID / _SECRET / _ACCOUNT_NUMBER' });

  const dry = q.dry === '1';
  const live = ['on', 'true', '1'].includes(String(await getSecretFresh('FEDEX_AUTOCLOSE_LIVE') || '').trim().toLowerCase()) && !dry;

  // Open returns that carry a FedEx tracking # (numeric; skip UPS 1Z... + blanks).
  let openr = [];
  try {
    const r = await loadOpenReturns({ includePending: false, resolveTech: false });
    openr = (r.returns || []).filter((o) => o.tracking && /^[0-9]{10,}$/.test(String(o.tracking).replace(/\s/g, '')));
  } catch (e) { return json(200, { ok: false, error: 'load returns failed: ' + String((e && e.message) || e) }); }

  const nums = [...new Set(openr.map((o) => String(o.tracking).replace(/\s/g, '')))].slice(0, MAX_TRACK);
  const trackMap = {};
  for (let i = 0; i < nums.length; i += 30) {
    const batch = nums.slice(i, i + 30);
    try { const d = await fedex.track(batch); Object.assign(trackMap, parseTrack(d)); } catch (_) {}
  }

  const delivered = []; let closed = 0; const stillOut = [];
  for (const o of openr) {
    const t = String(o.tracking).replace(/\s/g, '');
    const info = trackMap[t];
    if (!info) continue;
    if (info.delivered) {
      delivered.push({ job_id: o.job_id, part: o.part, claim: o.claim, distributor: o.distributor, tracking: t, delivered_at: info.deliveredAt });
      if (live) {
        // Same close path as the manual "Shipped ✓" tap (warranty_part_status shipped),
        // PLUS the FedEx delivery proof in the metadata = automatic chargeback shield.
        try {
          await crud.logEvent('warranty_part_status', {
            status: 'shipped', claim: String(o.claim || '').replace(/[^0-9]/g, ''), part: o.part || '', rma: o.rma || '',
            tracking: t, distributor: o.distributor || '', job_id: o.job_id || null,
            by: 'fedex_auto', fedex_delivered: true, fedex_status: info.status || '', delivered_at: info.deliveredAt || '', at_ms: Date.now(),
          });
          closed++;
        } catch (_) {}
      }
    } else if (info.status) { stillOut.push({ tracking: t, status: info.status }); }
  }

  const out = {
    ok: true, mode: live ? 'LIVE' : (dry ? 'dry' : 'shadow'),
    open_with_fedex_tracking: openr.length, tracked_this_run: nums.length,
    delivered_count: delivered.length, closed_count: closed,
    delivered: delivered.slice(0, 40),
  };
  if (!live) out.note = 'SHADOW — nothing closed. The delivered[] list is FedEx-confirmed and WOULD auto-close. Set vault FEDEX_AUTOCLOSE_LIVE=true to turn it on.';
  try { await crud.logEvent('fedex_autoclose_run', { mode: out.mode, delivered: delivered.length, closed, tracked: nums.length, at_ms: Date.now() }); } catch (_) {}
  return json(200, out);
};
