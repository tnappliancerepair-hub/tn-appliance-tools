// loop-churn-breakdown — diagnostic. Answers "what is the loop firing thousands
// of times?" Pulls recent event_log + colony_signals rows and counts them by
// action / signal_type so we can see the runaway. Office-password gated.
//
//   POST { password, pages? }  ->  { ok, event_log:{scanned, by_action[]},
//                                     signals:{scanned, by_type[]} }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
const COLONY_SIGNALS = 38;

exports.config = { timeout: 26 };

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

async function bulk(tableId, maxPages) {
  const PER = 250, BATCH = 6;
  const all = []; let stop = false;
  for (let base = 1; base <= maxPages && !stop; base += BATCH) {
    const pages = [];
    for (let p = base; p < base + BATCH && p <= maxPages; p++) pages.push(p);
    const batches = await Promise.all(pages.map(async (p) => {
      const r = await fetch(`${META}/table/${tableId}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }),
      });
      if (!r.ok) return [];
      const j = await r.json().catch(() => ({}));
      return (j.items || []);
    }));
    for (const rows of batches) { all.push(...rows); if (rows.length < PER) stop = true; }
  }
  return all;
}

function topCounts(rows, keyFn, n) {
  const c = {};
  for (const r of rows) { const k = keyFn(r) || '(blank)'; c[k] = (c[k] || 0) + 1; }
  return Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, n).map((k) => ({ key: k, count: c[k] }));
}

// rough age of the scanned window (oldest→newest created_at)
function windowSpan(rows) {
  const ts = rows.map((r) => Number(r.created_at) || 0).filter(Boolean);
  if (!ts.length) return null;
  const min = Math.min(...ts), max = Math.max(...ts);
  const mins = Math.round((max - min) / 60000);
  return { minutes: mins, rows: rows.length, per_min: mins ? Math.round(rows.length / mins) : null };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const password = String(b.password || b.pin || '');
  if (!password) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'password_required' }) };
  try {
    const vr = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const vd = await vr.json().catch(() => ({}));
    if (!vd || !vd.success) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'wrong_password' }) };
  } catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'verify_failed' }) }; }

  const pages = Math.min(Math.max(Number(b.pages || 12), 4), 24);
  try {
    const [ev, sig] = await Promise.all([bulk(EVENT_LOG, pages), bulk(COLONY_SIGNALS, pages).catch(() => [])]);
    // Isolate POST-restart rows so we can tell if the loop is STILL writing to
    // Xano right now (vs. these being pre-restart rows in the window).
    const now = Date.now();
    const recent = (rows, mins) => rows.filter((r) => (now - (Number(r.created_at) || 0)) <= mins * 60000);
    const ev5 = recent(ev, 5), ev15 = recent(ev, 15);
    return { statusCode: 200, body: JSON.stringify({
      ok: true,
      event_log: { scanned: ev.length, window: windowSpan(ev), by_action: topCounts(ev, (r) => r.action, 25) },
      last_5min:  { rows: ev5.length,  by_action: topCounts(ev5, (r) => r.action, 12) },
      last_15min: { rows: ev15.length, by_action: topCounts(ev15, (r) => r.action, 12) },
      signals: { scanned: sig.length, window: windowSpan(sig), by_type: topCounts(sig, (r) => r.signal_type, 25), by_source: topCounts(sig, (r) => r.source_colony, 15) },
    }, null, 2) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
