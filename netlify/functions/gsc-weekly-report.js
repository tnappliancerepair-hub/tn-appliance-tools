// gsc-weekly-report — tracks where we rank for REPAIR-intent terms week over week
// so Teddy sees the climb. Each weekly run snapshots the repair queries (event_log
// 'gsc_snapshot'), diffs against the prior snapshot, and texts the movement:
// climbers, new page-1 entries, striking-distance, and any slips.
//
//   (scheduled weekly)        -> snapshot + diff + SMS Teddy (skips if <5 days since last)
//   ?report=1&secret=         -> read latest two snapshots, return the diff as JSON (no write/SMS)
//   ?secret=&force=1          -> force a fresh snapshot + SMS now
//   ?secret=&dryrun=1         -> compute + return, do not SMS
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const gsc = require('./_lib/search-console');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const OWNER = '+16154855795';
const ACTION = 'gsc_snapshot';
// New-language folders to track week-over-week (the multilingual SEO push).
const LANGS = [['es', 'Spanish'], ['vi', 'Vietnamese'], ['fr', 'French'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ru', 'Russian']];
// repair-intent we WANT to grow; exclude used/buy-intent (don't celebrate the legacy)
const REPAIR_RE = /\b(repair|installation|install|vent|fix|technician|repairman)\b/i;
const BUY_RE = /\b(used|scratch|dent|for ?sale|\bbuy\b|\bsell\b)\b/i;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function todayCT() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }

async function recentSnapshots(n) {
  try { return await crud.searchPage(crud.TABLES.event_log, { action: ACTION }, { id: 'desc' }, n); } catch (_) { return []; }
}
// build a {query: position} map from a snapshot's rows
function posMap(snap) { const m = {}; for (const r of (snap.rows || [])) m[r.q] = r.p; return m; }

function diff(curRows, prevMap) {
  const climbers = [], slippers = [], newPage1 = [], striking = [];
  for (const r of curRows) {
    const prev = prevMap[r.q];
    const d = (prev != null) ? Math.round((prev - r.p) * 10) / 10 : null; // + = climbed (lower pos)
    const item = { q: r.q, pos: r.p, prev: prev != null ? prev : null, delta: d, impr: r.i };
    if (d != null && d >= 1.0) climbers.push(item);
    if (d != null && d <= -1.5) slippers.push(item);
    if (r.p <= 10 && (prev == null || prev > 10)) newPage1.push(item);
    if (r.p >= 4.5 && r.p <= 15) striking.push(item);
  }
  climbers.sort((a, b) => b.delta - a.delta);
  slippers.sort((a, b) => a.delta - b.delta);
  striking.sort((a, b) => a.pos - b.pos);
  return { climbers, slippers, newPage1, striking };
}

async function buildCurrent() {
  const res = await gsc.query({ days: 28, dimensions: ['query'], rowLimit: 500 });
  const rows = (res.rows || [])
    .map((x) => ({ q: (x.keys && x.keys[0]) || '', p: Math.round((x.position || 0) * 10) / 10, i: x.impressions || 0, c: x.clicks || 0 }))
    .filter((r) => r.q && r.i >= 3 && REPAIR_RE.test(r.q) && !BUY_RE.test(r.q))
    .sort((a, b) => b.i - a.i)
    .slice(0, 70);
  return rows;
}

// page-level coverage: how many distinct pages Google actually SURFACES (a clean
// proxy for "indexed + getting shown"). 90-day window catches the long tail.
// surfacing = pages with >=1 impression; page1 = pages averaging position <=10.
async function buildPages() {
  const res = await gsc.query({ days: 90, dimensions: ['page'], rowLimit: 5000 });
  const rows = res.rows || [];
  let surfacing = 0, page1 = 0, impressions = 0;
  for (const r of rows) {
    const i = r.impressions || 0;
    if (i > 0) surfacing++;
    if (i > 0 && (r.position || 99) <= 10) page1++;
    impressions += i;
  }
  return { surfacing, page1, impressions };
}

function pagesLine(pages, prev) {
  if (!pages) return null;
  const dS = prev ? pages.surfacing - prev.surfacing : null;
  const dP = prev ? pages.page1 - prev.page1 : null;
  const sgn = (n) => (n > 0 ? `+${n}` : `${n}`);
  // Headline: the indexing count Teddy watches climb. "surfacing" = pages Google
  // indexed AND showed in 90d (the reliable indexed floor).
  return `🔎 Indexed & showing on Google: ${pages.surfacing} pages${dS != null ? ` (${sgn(dS)} this wk)` : ''} · ${pages.page1} on page 1${dP != null ? ` (${sgn(dP)})` : ''}`;
}

// New-language coverage: bucket non-English pages by folder so the multilingual
// push is trackable in the same weekly text.
async function buildLanguages() {
  const res = await gsc.query({ days: 28, dimensions: ['page'], rowLimit: 5000 });
  const rows = res.rows || [];
  const by = {}; for (const [c] of LANGS) by[c] = { impr: 0, pages: 0 };
  let total_impr = 0, total_pages = 0;
  for (const r of rows) {
    const url = (r.keys && r.keys[0]) || '';
    const i = r.impressions || 0;
    for (const [c] of LANGS) {
      if (url.includes('/' + c + '/')) { by[c].impr += i; if (i > 0) { by[c].pages++; total_impr += i; total_pages++; } break; }
    }
  }
  return { by, total_impr, total_pages };
}
function langLine(langs, prev) {
  if (!langs) return null;
  const d = prev ? langs.total_impr - prev.total_impr : null;
  const sgn = (n) => (n > 0 ? `+${n}` : `${n}`);
  const parts = LANGS.map(([c]) => { const x = langs.by[c]; return x && x.impr > 0 ? `${c} ${x.impr}` : null; }).filter(Boolean).slice(0, 6);
  return `🌐 New-language pages: ${langs.total_impr} impr${d != null ? ` (${sgn(d)})` : ''} · ${langs.total_pages} pages ranking${parts.length ? ' — ' + parts.join(' · ') : ''}`;
}

function smsDigest(d, pages, prevPages, langs, prevLangs) {
  const lines = ['📊 Weekly SEO movement — TN Appliance'];
  const pl = pagesLine(pages, prevPages);
  if (pl) lines.push(pl);
  const ll = langLine(langs, prevLangs);
  if (ll) lines.push(ll);
  if (d.climbers.length) lines.push('📈 Up: ' + d.climbers.slice(0, 5).map((x) => `${x.q} ${x.prev}→${x.pos} (+${x.delta})`).join(' · '));
  if (d.newPage1.length) lines.push('⭐ New page-1: ' + d.newPage1.slice(0, 4).map((x) => `${x.q} #${x.pos}`).join(' · '));
  if (d.striking.length) lines.push('🎯 Almost pg-1: ' + d.striking.slice(0, 4).map((x) => `${x.q} #${x.pos}`).join(' · '));
  if (d.slippers.length) lines.push('📉 Slipped: ' + d.slippers.slice(0, 3).map((x) => `${x.q} ${x.prev}→${x.pos}`).join(' · '));
  if (!d.climbers.length && !d.newPage1.length && !d.striking.length && !d.slippers.length) lines.push('No tracked repair-term movement this week — watch the pages-on-Google count climb as new pages index.');
  return lines.join('\n');
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';

  // ----- VIEW: read-only diff of the latest two snapshots -----
  if (q.report === '1') {
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
    const snaps = await recentSnapshots(2);
    if (!snaps.length) return json(200, { ok: true, note: 'no snapshots yet — the weekly run will create the first one.' });
    const cur = meta(snaps[0]);
    const prevSnap = snaps[1] ? meta(snaps[1]) : null;
    const prevMap = prevSnap ? posMap(prevSnap) : {};
    return json(200, { ok: true, latest_date: cur.date, prior_date: prevSnap ? prevSnap.date : null, tracked: (cur.rows || []).length, pages: cur.pages || null, pages_prior: prevSnap ? (prevSnap.pages || null) : null, langs: cur.langs || null, langs_prior: prevSnap ? (prevSnap.langs || null) : null, movement: diff(cur.rows || [], prevMap), all: cur.rows });
  }

  // ----- RUN: snapshot + diff + SMS (weekly; skip if <5 days since last unless force) -----
  const manual = q.secret === admin;
  if (q.report !== '1' && !manual && !event.headers) { /* scheduled invocation — proceed */ }
  if (q.secret && !manual) return json(401, { ok: false, error: 'unauthorized' });

  const snaps = await recentSnapshots(2);
  const last = snaps[0] ? meta(snaps[0]) : null;
  if (last && last.date && !q.force) {
    const ageDays = (Date.now() - Date.parse(last.date + 'T00:00:00Z')) / 86400000;
    if (ageDays < 5) return json(200, { ok: true, skipped: 'last snapshot ' + last.date + ' (<5d) — use &force=1 to override' });
  }

  let curRows;
  try { curRows = await buildCurrent(); } catch (e) { return json(200, { ok: false, error: 'gsc query failed: ' + String((e && e.message) || e) }); }
  let pages = null;
  try { pages = await buildPages(); } catch (_) {}
  let langs = null;
  try { langs = await buildLanguages(); } catch (_) {}
  const prevMap = last ? posMap(last) : {};
  const prevPages = last ? (last.pages || null) : null;
  const prevLangs = last ? (last.langs || null) : null;
  const movement = diff(curRows, prevMap);

  // write the new snapshot (rows = ranking terms, pages = coverage counts, langs = new-language coverage)
  try { await crud.logEvent(ACTION, { date: todayCT(), rows: curRows, pages, langs }); } catch (_) {}

  const digest = smsDigest(movement, pages, prevPages, langs, prevLangs);
  let sms = 'skipped';
  if (!q.dryrun) { try { await sendSms(OWNER, digest, 'owner', 'gsc_weekly_report'); sms = 'sent'; } catch (e) { sms = String(e.message || e); } }
  return json(200, { ok: true, snapshot_date: todayCT(), tracked: curRows.length, pages, pages_prior: prevPages, langs, langs_prior: prevLangs, sms, digest, movement });
};

// Exported so the non-scheduled companion (gsc-report) can recompute on demand —
// Netlify blocks manual HTTP to this scheduled function (403). (2026-08-04)
exports.buildCurrent = buildCurrent;
exports.buildPages = buildPages;
exports.buildLanguages = buildLanguages;
exports.diff = diff;
exports.smsDigest = smsDigest;
exports.posMap = posMap;
exports.todayCT = todayCT;
exports.ACTION = ACTION;
