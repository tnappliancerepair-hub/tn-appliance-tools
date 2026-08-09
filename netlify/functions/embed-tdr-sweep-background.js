// embed-tdr-sweep-background — the always-on TDR→brain embedder.
//
// Why this exists: EMBED_TDR (the semantic "similar jobs" vector enrichment) used to
// run ONLY on the colony loop on the Mac Mini. When that Mac loop is down, completed
// TDRs stop being embedded — exactly what happened (loop dark 14+ days, 0 embeds).
// This moves the same work to a Netlify cron so the vector store keeps growing whether
// or not the Mac is up — matching the reliability-first "the brain can't hiccup"
// architecture, same as the predict/grade loop already does.
//
// It is IDEMPOTENT and safe to run alongside the Mac loop:
//   • candidates = jobs with a `job_completed` event in the window
//   • dedup against prior `tdr_embedded` events (this fn) AND `embed_tdr_handled`
//     events (the Mac loop) so neither re-embeds what the other already did
//   • save_embedding upserts by (source_table, source_row_id) so even a race is a no-op
//   • skips when OPENAI_API_KEY is unset (embed-text returns placeholder/dummy vectors
//     — we never pollute the store with dummies)
//
// Background fn (15-min budget) so a backlog can't hit the 10s sync wall.
// POST { secret, days?, max? }  — secret = VAPI_ADMIN_SECRET (or {next_run} from cron).
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const CONCURRENCY = 6;
const DEFAULT_MAX = 200;   // background has 15 min — clear real backlogs in a run

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function jfetch(url, opts) { try { const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, opts)); return await r.json(); } catch (_) { return null; } }

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const scheduled = !!b.next_run;
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const q = (event && event.queryStringParameters) || {};
  const secret = b.secret || q.secret;
  if (!scheduled && secret !== admin) { return { statusCode: 401, body: 'unauthorized' }; }

  const days = Number(b.days || q.days) || 7;
  const max = Math.min(Number(b.max || q.max) || DEFAULT_MAX, 400);

  // 1) candidates: jobs completed in the window (Teddy's "each job we complete")
  let completed = [];
  const cd = await jfetch(`${XANO}/list_recent_event_log?action=job_completed&days_back=${days}&limit=500`);
  completed = (cd && (cd.items || (Array.isArray(cd) ? cd : []))) || [];

  // 2) dedup set — both this fn's marker AND the Mac loop's marker. Read from the
  // LIVE list_recent_event_log endpoint (not crud.searchPage / metadata content-search,
  // which LAGS new writes — the documented index-lag footgun — so it returned empty for
  // just-written markers and every run re-embedded). Live reader caps ~50 rows, which is
  // why the cron window is kept small (days=4: ~7 completions/day → well under the cap,
  // so the whole window's markers are seen). save_embedding upserts by
  // (source_table, source_row_id), so any marker we miss re-embeds harmlessly (no dupes).
  const done = new Set();
  for (const act of ['tdr_embedded', 'embed_tdr_handled']) {
    const dd = await jfetch(`${XANO}/list_recent_event_log?action=${act}&days_back=${days + 3}&limit=500`);
    for (const r of (dd && (dd.items || (Array.isArray(dd) ? dd : []))) || []) { const j = Number(metaOf(r).job_id); if (j) done.add(j); }
  }

  // 3) unique, not-yet-embedded job ids
  const seen = new Set(); const cands = [];
  for (const r of completed) { const jid = Number(metaOf(r).job_id); if (!jid || seen.has(jid) || done.has(jid)) continue; seen.add(jid); cands.push(jid); }
  const batch = cands.slice(0, max);

  async function embedOne(jid) {
    const d = await jfetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jid }) });
    const tdr = d && d.tdr;
    if (!tdr) { try { await crud.logEvent('tdr_embedded', { job_id: jid, outcome: 'no_tdr', at_ms: Date.now() }); } catch (_) {} return 'no_tdr'; }
    // Same fields + join the Mac loop uses, so both paths produce identical text.
    const parts = [tdr.diagnosis, tdr.failure_cause, tdr.failed_component, tdr.repair_completed, tdr.verified_part_number, tdr.technician_notes].filter((p) => p && String(p).trim().length > 0);
    if (parts.length === 0) { try { await crud.logEvent('tdr_embedded', { job_id: jid, outcome: 'tdr_empty', at_ms: Date.now() }); } catch (_) {} return 'tdr_empty'; }
    const text = parts.join(' | ');
    const er = await jfetch(`${SITE}/.netlify/functions/embed-text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source_table: 'technician_decision_report', source_row_id: tdr.id || jid, company_id: 1, namespace: 'tdr' }) });
    const placeholder = !!(er && er.placeholder);
    const okr = !!(er && er.ok) && !placeholder;
    // Don't mark done on a placeholder (no OPENAI key) — we want to retry once the key
    // is set rather than lock in a dummy. Otherwise mark so we never re-embed.
    if (!placeholder) { try { await crud.logEvent('tdr_embedded', { job_id: jid, tdr_id: tdr.id || null, outcome: okr ? 'embedded' : 'embed_failed', char_count: text.length, at_ms: Date.now() }); } catch (_) {} }
    return placeholder ? 'placeholder_skipped' : (okr ? 'embedded' : 'embed_failed');
  }

  const tally = {};
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const res = await Promise.all(batch.slice(i, i + CONCURRENCY).map(embedOne));
    for (const o of res) tally[o] = (tally[o] || 0) + 1;
  }

  const summary = { ok: true, code: 'live-dedup-v2', window_days: days, done_seen: done.size, candidates: cands.length, processed: batch.length, remaining: Math.max(0, cands.length - batch.length), embedded: tally.embedded || 0, tally };
  try { await crud.logEvent('embed_tdr_sweep_run', Object.assign({ at_ms: Date.now() }, summary)); } catch (_) {}
  // Background fns can't return a body to the caller; the run is recorded to event_log.
  return { statusCode: 200, body: JSON.stringify(summary) };
};
