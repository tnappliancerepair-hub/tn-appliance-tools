// lead-text-block-watch — bulletproofs the "we text you right back" closers. The Xano
// intake-only gate silently drops any customer text whose context_tag isn't allowlisted.
// That's great for killing over-texting, but if a DEAL-CLOSING lead reply (vent / cash /
// multi-family / plan) ever gets a wrong tag, the lead gets total silence and we'd never
// know. This scans the block log and PAGES THE OWNER the moment a closer-shaped text is
// dropped, so a silent-failure regression surfaces in minutes, not lost revenue.
//
//   scheduled (netlify.toml) · manual: ?secret=VAPI_ADMIN_SECRET[&dryrun=1][&hours=6]
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { officeTaskAlert } = require('./_lib/office-alert');
const crud = require('./_lib/xano/metadata-crud');
const OWNER = '+16154855795';
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// A blocked send is a LEAD-CLOSER (not routine over-texting) if its tag or body looks
// like our first-touch reply to a fresh lead.
const CLOSER_TAG = /web_book|speed|_lead\b|lead_|book_repair|vent_plan|b2b|quote|plan|first_touch/i;
const CLOSER_BODY = /got your|text you right back|what days|request!|vent care plan|whole-property/i;

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  }
  const dry = q.dryrun === '1';
  const hours = Math.max(1, Math.min(72, parseInt(q.hours || '6', 10) || 6));
  const cutoff = Date.now() - hours * 3600000;
  const DEDUP_MIN = 180;

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sms_blocked_non_intake' }, { id: 'desc' }, 100); } catch (_) { return j(200, { ok: false, error: 'scan failed' }); }

  const hits = [];
  for (const r of rows) {
    let m = (r && r.metadata) || {};
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const at = Number(m.at_ms || 0) || (r.created_at ? Number(r.created_at) : 0);
    if (at && at < cutoff) continue;
    const tag = String(m.context_tag || '');
    const body = String(m.body_preview || m.body || '');
    if (CLOSER_TAG.test(tag) || CLOSER_BODY.test(body)) {
      hits.push({ tag: tag || '(none)', last4: m.recipient_last4 || '', body: body.slice(0, 50) });
    }
  }

  if (hits.length && !dry) {
    // dedup
    let recent = false;
    try { const d = await crud.searchOne(crud.TABLES.event_log, { action: 'lead_text_block_alerted' }, { id: 'desc' }); if (d && d.metadata) { const dm = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata; recent = (Date.now() - Number(dm.at_ms || 0)) < DEDUP_MIN * 60000; } } catch (_) {}
    if (!recent) {
      const lines = hits.slice(0, 6).map((h) => `• tag "${h.tag}" → …${h.last4}: "${h.body}"`).join('\n');
      const body = `[ant] 🚨 ${hits.length} deal-closing lead text(s) were BLOCKED by the intake gate in the last ${hours}h — leads may be getting SILENCE. Fix the sender's context_tag:\n${lines}`;
      try { await officeTaskAlert(body, 'lead_text_block_alert'); } catch (_) {}   // → Danielle+Sofia, biz hours
      try { await crud.logEvent('lead_text_block_alerted', { count: hits.length, at_ms: Date.now() }); } catch (_) {}
    }
  }

  return j(200, { ok: true, dry, window_hours: hours, blocked_closers: hits.length, hits: hits.slice(0, 10) });
};
