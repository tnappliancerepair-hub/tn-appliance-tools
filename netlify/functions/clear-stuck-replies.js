// clear-stuck-replies — one-off cleanup: office "Reply (auto-translate)" replies
// were logged as `translated_reply_sent`, an action the Messages page doesn't
// recognize as an outbound — so threads Danielle ALREADY replied to kept showing
// the red REPLY badge (2026-06-30). send-translated-reply now logs the correct
// action going forward; this relabels the EXISTING rows so her stuck threads clear.
//
//   GET ?secret=<admin>[&days=14]            DRY RUN — list what it would relabel
//   GET ?secret=<admin>&confirm=1            relabel translated_reply_sent -> customer_sms_reply
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const T = 3; // event_log
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const tok = process.env.XANO_METADATA_TOKEN;
  if (!tok) return j(500, { ok: false, error: 'no metadata token' });
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const dry = q.confirm !== '1';
  const days = Math.max(1, Math.min(60, parseInt(q.days, 10) || 14));
  const cutoff = Date.now() - days * 86400000;

  // Pull recent translated_reply_sent rows.
  let rows = [];
  try {
    const r = await fetch(`${META}/table/${T}/content/search`, {
      method: 'POST', headers: H, body: JSON.stringify({ search: { action: 'translated_reply_sent' }, per_page: 200, page: 1, sort: { id: 'desc' } }),
    });
    const d = await r.json().catch(() => ({}));
    rows = (d.items || []).filter((x) => { const m = x.created_at ? new Date(x.created_at).getTime() : Date.now(); return m >= cutoff; });
  } catch (e) { return j(200, { ok: false, error: 'search: ' + String(e.message || e) }); }

  const plan = rows.map((x) => {
    let m = x.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    m = m || {};
    return { id: x.id, phone: m.phone || '', body: (m.translated || m.english || '').slice(0, 60), meta: m };
  });

  if (dry) return j(200, { ok: true, mode: 'dryrun', would_relabel: plan.length, sample: plan.slice(0, 15).map((p) => ({ id: p.id, phone: p.phone, body: p.body })) });

  let done = 0; const failed = [];
  for (const p of plan) {
    const meta = Object.assign({}, p.meta, { body: p.meta.translated || p.meta.english || p.meta.body || '', message: p.meta.translated || p.meta.english || p.meta.message || '' });
    try {
      const r = await fetch(`${META}/table/${T}/content/${p.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ action: 'customer_sms_reply', metadata: meta }) });
      if (r.ok) done++; else failed.push({ id: p.id, status: r.status });
    } catch (e) { failed.push({ id: p.id, err: String(e.message || e) }); }
  }
  return j(200, { ok: true, mode: 'relabeled', relabeled: done, failed: failed.length, failed_list: failed.slice(0, 8) });
};
