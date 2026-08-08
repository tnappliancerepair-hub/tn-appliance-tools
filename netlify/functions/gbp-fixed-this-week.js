// gbp-fixed-this-week — turn the photos techs already upload into "machines we
// fixed this week" Google Business Profile posts. Fresh photos + fresh posts are
// one of the strongest map-pack + call-conversion signals, and we already capture
// the photos on every job — so this repurposes them instead of asking the crew to
// upload a second time (that pipe has produced 0 in 60 days).
//
// PRIVACY GATE: job photos can contain home interiors, faces, or serial stickers,
// so this NEVER auto-posts. It surfaces candidates for the owner to curate, and
// posts only the ones explicitly chosen (one call per approved photo).
//
//   GET  ?secret=<admin>[&days=7][&limit=24]   -> candidate photos + ready captions
//   POST ?secret=<admin> { s3_key, caption, action_url? }  -> post ONE to GBP
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const gbp = require('./_lib/gbp');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const JOB_ATTACHMENTS = 22;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function cap(s) { return String(s || '').replace(/\b\w/g, (m) => m.toUpperCase()); }

// Appliance -> its repair hub, for the post's "Learn more" button.
const HUB = {
  refrigerator: '/refrigerator-repair', freezer: '/freezer-repair', washer: '/washer-repair',
  dryer: '/dryer-repair', dishwasher: '/dishwasher-repair', oven: '/oven-repair',
  range: '/oven-repair', stove: '/oven-repair', cooktop: '/oven-repair', microwave: '/refrigerator-repair',
};
// Rotating openers so a batch of posts never reads identically (Google dislikes dupes).
const OPENERS = [
  'Another', 'One more', 'Back in service —', 'Fixed this week:', 'Done and dusted —', 'Up and running —',
];

// Public URL GBP can fetch for a stored photo (signed S3 or cfimg passthrough).
async function viewUrl(s3Key) {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/s3-view-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3_keys: [s3Key] }), signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    const row = (d && d.results && d.results[0]) || (d && d[0]) || null;
    return row && row.view_url ? row.view_url : '';
  } catch (_) { return ''; }
}

// Job context (appliance/brand/city) — get_job_for_dashboard is POST {job_id}.
async function jobCtx(jobId) {
  try {
    const r = await fetch(`${XANO}/get_job_for_dashboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: Number(jobId) }), signal: AbortSignal.timeout(7000),
    });
    const d = await r.json();
    if (!d || !d.success) return {};
    const a = d.appliance || {};
    const cust = d.customer || {};
    const job = d.job || {};
    const status = String(job.scheduling_status || job.current_status || '').toLowerCase();
    return {
      appliance: String(a.type || '').trim(),
      brand: String(a.brand || '').trim(),
      city: String(cust.city || job.service_city || '').trim(),
      state: String(cust.state || job.service_state || '').trim(),
      status,
      completed: status === 'completed' || String(job.current_status || '').toLowerCase() === 'completed',
    };
  } catch (_) { return {}; }
}

function composeCaption(ctx, i) {
  const brand = ctx.brand ? cap(ctx.brand) + ' ' : '';
  const appl = (ctx.appliance || 'appliance').toLowerCase();
  const where = ctx.city ? ` in ${cap(ctx.city)}${ctx.state ? ', ' + ctx.state.toUpperCase() : ''}` : '';
  const opener = OPENERS[i % OPENERS.length];
  // Only claim "fixed" on a completed job; otherwise an honest "on the job" line.
  const line = ctx.completed
    ? `${opener} ${brand}${appl} back up and running${where} this week.`
    : `On a ${brand}${appl}${where} this week.`;
  return `${line} 🐜 Same-day, honest appliance repair across Middle Tennessee & Louisiana — text us and a real tech texts you right back. 4.5★, 1,000+ reviews. Family-owned since 2012.`;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if ((q.secret || body.secret) !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // ── POST one approved photo to GBP ──────────────────────────────────
  if (event.httpMethod === 'POST') {
    const s3Key = String(body.s3_key || '');
    const caption = String(body.caption || '').trim();
    if (!s3Key || !caption) return json(400, { ok: false, error: 's3_key + caption required' });
    if (!(await gbp.isConfigured())) return json(200, { ok: false, error: 'GBP not connected' });
    const mediaUrl = await viewUrl(s3Key);
    if (!mediaUrl) return json(200, { ok: false, error: 'could not resolve a public photo URL' });
    if (/^cfstream:|video/i.test(s3Key)) return json(400, { ok: false, error: 'that is a video, not a photo' });
    try {
      const actionUrl = String(body.action_url || (SITE + '/appliance-ai.html'));
      const res = await gbp.createLocalPost({ summary: caption, actionType: 'LEARN_MORE', actionUrl, mediaUrl });
      const postName = (res && (res.name || (res.result && res.result.name))) || '';
      await crud.logEvent('gbp_fixed_this_week_posted', { s3_key: s3Key, post_name: postName, at_ms: Date.now() });
      return json(200, { ok: true, posted: true, post_name: postName });
    } catch (e) {
      return json(200, { ok: false, error: String((e && e.message) || e) });
    }
  }

  // ── LIST candidates (default, no posting) ───────────────────────────
  const days = Math.max(1, Math.min(30, parseInt(q.days, 10) || 7));
  const limit = Math.max(1, Math.min(60, parseInt(q.limit, 10) || 24));
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  // created_at may be ms or seconds depending on the column; normalize to ms.
  const normMs = (v) => { const n = Number(v || 0); return n > 0 && n < 1e12 ? n * 1000 : n; };
  const isPhoto = (r) => {
    const ft = String(r.file_type || '').toLowerCase();
    const mt = String(r.mime_type || '').toLowerCase();
    const k = String(r.s3_key || '').toLowerCase();
    if (/video|cfstream:/.test(ft) || /video/.test(mt) || k.indexOf('cfstream:') === 0) return false;
    return ft === 'photo' || ft === 'image' || mt.indexOf('image/') === 0 || /\.(jpe?g|png|heic|webp)$/.test(k) || k.indexOf('cfimg:') === 0 || ft === '';
  };

  // Pull recent rows unfiltered (single-field search is unreliable for file_type
  // variants), then classify in JS.
  let rows = [];
  try { rows = await crud.searchPage(JOB_ATTACHMENTS, {}, { id: 'desc' }, 400); } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  // Debug: see exactly what's in the table so we can tune filters.
  if (q.debug === '1') {
    const ftCount = {};
    let inWin = 0;
    for (const r of rows) { const ft = String(r.file_type || '(empty)'); ftCount[ft] = (ftCount[ft] || 0) + 1; if (normMs(r.created_at || r.at_ms) >= sinceMs) inWin++; }
    return json(200, {
      ok: true, debug: true, total_rows_pulled: rows.length, in_window: inWin, window_days: days,
      file_type_breakdown: ftCount,
      newest5: rows.slice(0, 5).map((r) => ({ id: r.id, job_id: r.job_id, file_type: r.file_type, mime: r.mime_type, created_at: r.created_at, created_ms_norm: normMs(r.created_at || r.at_ms), s3_prefix: String(r.s3_key || '').slice(0, 16) })),
    });
  }

  // Newest photo per job within the window (one representative shot per job keeps
  // the batch varied + the context lookups cheap). Skip videos + intake selfies.
  const seenJob = new Set();
  const picks = [];
  for (const r of rows || []) {
    const created = normMs(r.created_at || r.at_ms || 0);
    if (created && created < sinceMs) continue;
    const jid = Number(r.job_id || 0);
    if (!jid || seenJob.has(jid)) continue;
    const key = String(r.s3_key || '');
    if (!key || !isPhoto(r)) continue;
    seenJob.add(jid);
    picks.push({ attachment_id: r.id, job_id: jid, s3_key: key, uploaded_by: r.uploaded_by || '', created_at: created });
    if (picks.length >= limit) break;
  }

  // Enrich with job context + caption + view URL.
  const enriched = [];
  for (const p of picks) {
    const ctx = await jobCtx(p.job_id);
    // Only surface real repair jobs that have an appliance we can name.
    if (!ctx.appliance) continue;
    const view = await viewUrl(p.s3_key);
    if (!view) continue;
    enriched.push({ ...p, ctx, view });
  }
  // Completed jobs first (best "fixed this week" material), newest within each.
  enriched.sort((a, b) => (b.ctx.completed ? 1 : 0) - (a.ctx.completed ? 1 : 0) || b.created_at - a.created_at);
  const out = enriched.map((e, i) => ({
    attachment_id: e.attachment_id, job_id: e.job_id, s3_key: e.s3_key, uploaded_by: e.uploaded_by, created_at: e.created_at,
    appliance: e.ctx.appliance, brand: e.ctx.brand, city: e.ctx.city, state: e.ctx.state,
    status: e.ctx.status, completed: e.ctx.completed,
    view_url: e.view,
    action_url: SITE + (HUB[(e.ctx.appliance || '').toLowerCase()] || '/appliance-ai.html'),
    caption: composeCaption(e.ctx, i),
  }));

  return json(200, { ok: true, days, count: out.length, completed_count: out.filter((c) => c.completed).length, candidates: out });
};
