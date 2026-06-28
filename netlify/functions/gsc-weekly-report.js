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

function smsDigest(d) {
  const fmt = (x) => `${x.q} ${x.prev != null ? x.prev + '→' + x.pos : '#' + x.pos}`;
  const lines = ['📊 Weekly SEO movement — TN Appliance'];
  if (d.climbers.length) lines.push('📈 Up: ' + d.climbers.slice(0, 5).map((x) => `${x.q} ${x.prev}→${x.pos} (+${x.delta})`).join(' · '));
  if (d.newPage1.length) lines.push('⭐ New page-1: ' + d.newPage1.slice(0, 4).map((x) => `${x.q} #${x.pos}`).join(' · '));
  if (d.striking.length) lines.push('🎯 Almost pg-1: ' + d.striking.slice(0, 4).map((x) => `${x.q} #${x.pos}`).join(' · '));
  if (d.slippers.length) lines.push('📉 Slipped: ' + d.slippers.slice(0, 3).map((x) => `${x.q} ${x.prev}→${x.pos}`).join(' · '));
  if (lines.length === 1) lines.push('No tracked repair terms with impressions yet this week.');
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
    const prevMap = snaps[1] ? posMap(meta(snaps[1])) : {};
    return json(200, { ok: true, latest_date: cur.date, prior_date: snaps[1] ? meta(snaps[1]).date : null, tracked: (cur.rows || []).length, movement: diff(cur.rows || [], prevMap), all: cur.rows });
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
  const prevMap = last ? posMap(last) : {};
  const movement = diff(curRows, prevMap);

  // write the new snapshot
  try { await crud.logEvent(ACTION, { date: todayCT(), rows: curRows }); } catch (_) {}

  const digest = smsDigest(movement);
  let sms = 'skipped';
  if (!q.dryrun) { try { await sendSms(OWNER, digest, 'owner', 'gsc_weekly_report'); sms = 'sent'; } catch (e) { sms = String(e.message || e); } }
  return json(200, { ok: true, snapshot_date: todayCT(), tracked: curRows.length, sms, digest, movement });
};
