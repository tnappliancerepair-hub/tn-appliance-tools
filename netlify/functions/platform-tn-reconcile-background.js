// platform-tn-reconcile — teach the mirror that a job can LEAVE Xano's active set.
//
// The mirror only ever adds and updates: it fetches Xano's active jobs and upserts them.
// When a job is canceled in Xano it simply stops appearing in that fetch, and the platform
// keeps its last-known state forever. Measured 2026-09-10: 471 jobs canceled in Xano were
// still sitting in the office's Needs-Scheduled column as work to be booked, frozen at the
// state of a backfill a week earlier. The live work was all there — buried under dead cards.
//
// SCOPE IS DELIBERATELY NARROW: this closes CANCELED only. A previous bulk status "repair"
// on this codebase nearly flipped ~73 genuinely-unfinished jobs to completed by trusting a
// derived signal, so completed-vs-not is REPORTED here, never written. Cancel is the one
// transition that is unambiguous and is the one the office actually feels.
//
// Never reverts platform-native work: a job the crew completed HERE (completed_at set) that
// Xano hasn't caught up on is left alone and reported, never closed.
//
//   ?secret=<admin>[&dryrun=1]   -> { scanned, canceled, skipped_local_complete, report[] }
'use strict';

const { getSecret } = require('./_lib/secrets');

const XANO_META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const JOBS_TABLE = 7;
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const MAX_PAGES = 24;          // 500/page — covers the whole active id range with room to spare

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false;
  try { scheduled = !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'forbidden' }) };
  const dry = q.dryrun === '1';

  const base = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  const xtok = process.env.XANO_METADATA_TOKEN || (await getSecret('XANO_METADATA_TOKEN'));
  if (!base || !key || !xtok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'not_configured' }) };
  const SB = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const XH = { Authorization: 'Bearer ' + xtok, 'Content-Type': 'application/json' };

  // 1) Every platform job that came from Xano and is NOT already closed here.
  const rows = [];
  for (let from = 0; from < 8000; from += 1000) {
    const r = await fetch(
      `${base}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=not.is.null&status=neq.canceled` +
      `&select=id,xano_id,status,completed_at&order=xano_id.desc&offset=${from}&limit=1000`,
      { headers: SB, signal: AbortSignal.timeout(20000) });
    if (!r.ok) break;
    const d = await r.json().catch(() => []);
    rows.push(...d);
    if (d.length < 1000) break;
  }
  if (!rows.length) return { statusCode: 200, body: JSON.stringify({ ok: true, scanned: 0, note: 'nothing to reconcile' }) };
  const floor = Math.min(...rows.map((j) => Number(j.xano_id) || 0).filter(Boolean));

  // 2) Which of those are TERMINAL in Xano now. Search must carry a filter: an empty
  //    `search: {}` 400s on the metadata API (the mirror always searches by a status for
  //    exactly this reason), and the first cut of this sweep silently saw zero rows because
  //    of it. Paging the terminal statuses directly is also the smaller read - it is the
  //    only set this sweep acts on.
  const TERMINAL = ['canceled', 'cancelled', 'completed'];
  const xstat = new Map();
  const coverage = {};
  for (const st of TERMINAL) {
    let reached = null, pages = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let items = [];
      try {
        const r = await fetch(`${XANO_META}/table/${JOBS_TABLE}/content/search`, {
          method: 'POST', headers: XH,
          body: JSON.stringify({ search: { scheduling_status: st }, sort: { id: 'desc' }, per_page: 500, page }),
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) break;
        items = (await r.json()).items || [];
      } catch (_) { break; }
      pages++;
      if (!items.length) break;
      let lowest = Infinity;
      for (const j of items) {
        const id = Number(j.id || 0);
        if (!id) continue;
        lowest = Math.min(lowest, id);
        xstat.set(id, st);
      }
      reached = lowest;
      if (items.length < 500 || lowest <= floor) break;
    }
    // Say plainly whether this status was walked all the way back to the oldest job we hold.
    coverage[st] = { pages, reached_id: reached, complete: reached != null && reached <= floor };
  }

  // 3) Correct only the unambiguous transition.
  let canceled = 0, skippedLocal = 0, unseen = 0;
  const report = [];
  const toClose = [];
  for (const j of rows) {
    const s = xstat.get(Number(j.xano_id));
    if (s === undefined) { unseen++; continue; }      // not terminal in Xano — still live work
    if (!s.includes('cancel')) {
      // Report a completed-vs-not disagreement; never write it.
      if (s.includes('complet') && j.status !== 'completed') report.push({ xano_id: j.xano_id, platform: j.status, xano: s, action: 'reported_only' });
      continue;
    }
    if (j.completed_at) { skippedLocal++; report.push({ xano_id: j.xano_id, platform: j.status, xano: s, action: 'kept — finished on the platform' }); continue; }
    toClose.push(j);
  }

  if (!dry) {
    for (let i = 0; i < toClose.length; i += 100) {
      const chunk = toClose.slice(i, i + 100).map((j) => j.xano_id).join(',');
      const r = await fetch(`${base}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=in.(${chunk})`, {
        method: 'PATCH', headers: { ...SB, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'canceled' }), signal: AbortSignal.timeout(20000),
      });
      if (r.ok) canceled += Math.min(100, toClose.length - i);
    }
  } else { canceled = toClose.length; }

  // A background function answers 202 with no body, so the run has to leave its own record
  // — which a nightly reconcile wants regardless. Written even on a dry run.
  const summary = { ok: true, dryrun: dry, scanned: rows.length, xano_seen: xstat.size,
    canceled, skipped_local_complete: skippedLocal, still_active_in_xano: unseen, coverage, report: report.slice(0, 40) };
  try {
    await fetch(`${base}/rest/v1/event`, {
      method: 'POST', headers: { ...SB, Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: TN_COMPANY, type: 'tn_reconcile_run', entity: 'job', payload: summary }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {}

  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(summary, null, 2) };
};
