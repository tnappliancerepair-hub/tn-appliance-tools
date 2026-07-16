// sms-delivery-watch — catch a customer SMS line going DARK before Danielle finds out
// from a customer. Reads the real outbound delivery failures captured by _lib/sms-dlr
// (sms_delivery_failed rows) and texts Teddy if a customer line starts bouncing — the
// exact 10DLC-drop that took the human line down 2026-07-16 (Telnyx accepted every text
// but carriers dropped them silently). Threshold-gated so one bad number never alerts.
//
//   scheduled (netlify.toml) · manual: ?secret=VAPI_ADMIN_SECRET[&dryrun=1]
'use strict';

const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795';
const WINDOW_MIN = 70;      // look back ~1 hour
const THRESHOLD = 3;        // >=3 failed deliveries on one line in the window = an outage
const DEDUP_MIN = 180;      // don't re-alert the same line for 3h
const LINE_NAME = {
  '6158578800': 'the human/office text line (857-8800)',
  '6155889500': 'the AI text line (588-9500)',
  '6152802949': 'the main line (280-2949)',
  '6157575500': 'the tech line (757-5500)',
};
function last10(v) { return String(v || '').replace(/\D/g, '').slice(-10); }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  }
  const dry = q.dryrun === '1';

  // Failures in the window, grouped by sending line.
  let fails = [];
  try { fails = await crud.searchPage(3, { action: 'sms_delivery_failed' }, { created_at: 'desc' }, 300); } catch (_) {}
  const cutoff = Date.now() - WINDOW_MIN * 60000;
  const byLine = {};
  for (const r of fails) {
    const m = meta(r);
    const when = Number(m.at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
    if (when && when < cutoff) continue;
    const line = last10(m.line);
    if (!line) continue;
    (byLine[line] = byLine[line] || []).push(m);
  }

  // Recent alerts (dedup).
  let alerted = [];
  try { alerted = await crud.searchPage(3, { action: 'sms_delivery_alerted' }, { created_at: 'desc' }, 100); } catch (_) {}
  const alertCut = Date.now() - DEDUP_MIN * 60000;
  const recentlyAlerted = new Set();
  for (const r of alerted) { const m = meta(r); const when = Number(m.at_ms) || (r.created_at ? Date.parse(r.created_at) : 0); if (when >= alertCut) recentlyAlerted.add(last10(m.line)); }

  const outages = [];
  for (const [line, list] of Object.entries(byLine)) {
    if (list.length < THRESHOLD) continue;
    if (recentlyAlerted.has(line)) { outages.push({ line, count: list.length, skipped: 'deduped' }); continue; }
    const name = LINE_NAME[line] || ('a text line (' + line + ')');
    const body = `⚠️ Ant: ${name} isn't delivering — ${list.length} texts failed to reach customers in the last hour (carrier may be dropping them). Check the line / 10DLC status.`;
    if (!dry) {
      try { await sendSms(OWNER, body, 'owner', 'sms_delivery_alert'); } catch (_) {}
      try { await crud.logEvent('sms_delivery_alerted', { line, count: list.length, at_ms: Date.now() }); } catch (_) {}
    }
    outages.push({ line, count: list.length, alerted: !dry });
  }

  return j(200, { ok: true, window_min: WINDOW_MIN, threshold: THRESHOLD, dry, lines_checked: Object.keys(byLine).length, outages });
};
