// review-velocity-scorecard — makes the review FLYWHEEL visible. Reviews are the
// hinge of the whole SEO strategy: every posted review lifts the map pack AND adds
// keyword-rich organic content AND signals prominence — and reviews are produced by
// the jobs the map pack brings. If the hinge isn't turning, the flywheel sits still.
// We instrument phone trust + the knowledge brain nightly; this does the same for
// the one metric the map-pack + organic strategy depends on.
//
// It measures the funnel end-to-end and names WHERE it leaks:
//   completions  → asks sent → 👍/👎 replies → reviews actually POSTED (authoritative)
// The outcome metric (posted-review count) comes straight from Google (get-google-
// reviews), stored each run so the delta = true velocity. The funnel middle comes
// from fixed-action event rows (review_ask_sent, review_thumb) so it's exact-countable.
//
//   GET ?secret=<admin>            -> compute, store snapshot, return JSON
//   GET ?secret=<admin>&text=1     -> also text the owner the readout
//   GET ?secret=<admin>&days=7     -> funnel window + trend length (default 7)
// (A schedule-registered fn is 403 on direct HTTP, so this stays HTTP-callable and
//  review-velocity-scorecard-cron is the weekly trigger — mirrors the knowledge/phone split.)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net/.netlify/functions';
const OWNER = '+16154855795';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(row) { const m = meta(row); return Number(row.created_at || m.at_ms || 0); }
function dayCT(ms) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms)); }
function isoDateCT(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Count event_log rows for a fixed action within the window (+ optional metadata predicate).
async function countSince(action, sinceMs, pred) {
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 400); } catch (_) { return { n: 0, capped: false }; }
  let n = 0, oldestSeen = Infinity, any = false;
  for (const r of rows || []) {
    const t = tsOf(r); if (t) oldestSeen = Math.min(oldestSeen, t);
    if (t && t < sinceMs) continue;
    any = true;
    if (pred && !pred(meta(r), r)) continue;
    n++;
  }
  // capped = we pulled the max page and its oldest row is still inside the window,
  // so there may be more we didn't see (undercount risk — flag it honestly).
  const capped = (rows || []).length >= 400 && oldestSeen >= sinceMs;
  return { n, capped };
}

async function authoritativeReviewCount() {
  try {
    const r = await fetch(`${SITE}/get-google-reviews`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    return { count: Number(d.review_count || 0) || null, rating: Number(d.rating || 0) || null };
  } catch (_) { return { count: null, rating: null }; }
}

function diagnoseLeak(f) {
  // f = { completions, asks, thumbs, ups, downs, landed }
  if (f.completions === 0 && f.asks === 0) return { key: 'no_throughput', msg: 'no completed jobs in the window — nothing to ask. Upstream: is the job flow / tech_job_complete firing?' };
  if (f.completions > 0 && f.asks / Math.max(1, f.completions) < 0.5) return { key: 'ask_throughput', msg: `only ${f.asks} of ${f.completions} completions got asked — throughput leak. Check the sweep's gate / 60-day dedup / phone-on-file / live-completed re-check.` };
  if (f.asks > 0 && f.thumbs / Math.max(1, f.asks) < 0.25) return { key: 'engagement', msg: `${f.asks} asked but only ${f.thumbs} replied 👍/👎 — engagement leak. Customers aren't answering the "How'd we do?" text (timing / wording / send actually landing?).` };
  if (f.ups > 0 && f.landed != null && f.landed <= 0) return { key: 'conversion', msg: `${f.ups} tapped 👍 and got the Google link, but 0 reviews posted — conversion leak at the last step. The link-tap-to-post drop is where it dies (make posting one tap, pre-fill less, follow up once).` };
  if (f.landed != null && f.landed > 0) return { key: 'healthy', msg: `hinge is turning — ${f.landed} new review${f.landed === 1 ? '' : 's'} landed. Keep the asks flowing.` };
  return { key: 'baseline', msg: 'baseline set — velocity shows on the next run once we have a prior snapshot to diff.' };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const scheduled = !!(event && event.body && (() => { try { return JSON.parse(event.body).next_run; } catch (_) { return false; } })());
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== admin && q.secret !== GUARD_FALLBACK) return json(403, { ok: false, error: 'forbidden' });

  const now = Date.now();
  const days = Math.max(1, Math.min(90, Number(q.days) || 7));
  const since = now - days * 86400000;
  const todayDate = isoDateCT(now);

  // Funnel (window).
  const comp = await countSince('tech_job_complete', since, (m) => String(m.new_scheduling_status || '') === 'completed');
  const asks = await countSince('review_ask_sent', since);
  const up = await countSince('review_thumb', since, (m) => String(m.outcome || '') === 'up');
  const down = await countSince('review_thumb', since, (m) => String(m.outcome || '') === 'down');
  const thumbs = up.n + down.n;

  // Outcome (authoritative posted-review count) + prior snapshot for the delta.
  const gr = await authoritativeReviewCount();
  let prior = null, trend = [];
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'review_velocity_score' }, { id: 'desc' }, 30);
    for (const row of (rows || [])) {
      const m = meta(row); if (!m || !m.date) continue;
      if (m.date !== todayDate) { trend.push({ date: m.date, review_count: m.review_count, asks: m.asks_sent, landed: m.reviews_landed }); if (!prior) prior = m; }
    }
  } catch (_) {}
  trend = trend.slice(0, days - 1).reverse();

  const landed = (gr.count != null && prior && prior.review_count != null) ? (gr.count - Number(prior.review_count)) : null;

  const funnel = { completions: comp.n, asks: asks.n, thumbs, ups: up.n, downs: down.n, landed };
  const leak = diagnoseLeak(funnel);

  // Store today's snapshot (append-only; date-filtered reads make dupes harmless).
  try { await crud.logEvent('review_velocity_score', { date: todayDate, at_ms: now, window_days: days, review_count: gr.count, rating: gr.rating, completions: comp.n, asks_sent: asks.n, thumbs_up: up.n, thumbs_down: down.n, reviews_landed: landed, top_leak: leak.key }); } catch (_) {}

  const delta = (gr.count != null && prior && prior.review_count != null) ? gr.count - Number(prior.review_count) : null;
  const arrow = delta == null ? '—' : (delta > 0 ? `▲ +${delta}` : (delta < 0 ? `▼ ${delta}` : '● flat'));
  const capNote = (comp.capped || asks.capped) ? ' (counts capped — window busier than the 400-row page)' : '';
  const lines = [
    `📣 Review Velocity — ${dayCT(now)} (${days}d)`,
    `Reviews: ${gr.count != null ? gr.count : '?'}${gr.rating ? ` ★${gr.rating}` : ''}  ${arrow}${prior ? ` since ${prior.date} (${prior.review_count})` : ' (baseline)'}`,
    `Funnel: ${funnel.completions} done → ${funnel.asks} asked → ${funnel.ups}👍${funnel.downs ? ` / ${funnel.downs}👎` : ''}${landed != null ? ` → ${landed} posted` : ''}${capNote}`,
    `👉 ${leak.key === 'healthy' ? '' : 'Leak: '}${leak.msg}`,
  ];
  const readout = lines.join('\n');

  let texted = false;
  if (scheduled || q.text === '1') { try { await sendSms(OWNER, readout, 'owner', 'review_velocity_score'); texted = true; } catch (_) {} }

  return json(200, { ok: true, date: todayDate, window_days: days, review_count: gr.count, rating: gr.rating, funnel, leak, prior: prior || null, delta, trend: trend.concat([{ date: todayDate, review_count: gr.count, asks: asks.n, landed }]), texted, readout });
};

// Exported so the scheduled cron wrapper can reuse if ever needed.
exports.diagnoseLeak = diagnoseLeak;
