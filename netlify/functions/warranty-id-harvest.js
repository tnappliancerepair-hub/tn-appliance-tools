// warranty-id-harvest — build the per-job "all warranty numbers" collection.
//
// A warranty job carries several identifiers (SquareTrade claim #, ServicePower
// call # + extra dispatch #s, AHS/Frontdoor/NSA #s, our job #). Today we store
// only claim_number + dispatch_source_id, so a MeisterTask card that references
// a DIFFERENT one of the job's numbers can't be linked. This harvests every
// number MeisterTask has per card, links it to our job (via any number they
// share), and stores the union as a `warranty_ids` row -> now ANY of those
// numbers resolves to the job. (Teddy 2026-07-04)
//
//   GET                 run + persist
//   GET ?dryrun=1       show what WOULD be written, persist nothing
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG = 3;
const BOARDS = ['tn', 'nola', 'sched'];
const MAX_WRITES = 250;

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
function extractIds(s) {
  const out = new Set();
  const t = String(s || '');
  (t.match(/[A-Z]{2,4}\d{6,}/g) || []).forEach((n) => out.add(n));  // NSA-style AXM2026...
  (t.match(/\d{6,}/g) || []).forEach((n) => out.add(n));            // claim / call / dispatch #s
  return [...out];
}
async function getJSON(u) { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); return r.json(); }

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';

  // 1) Our jobs: index every number we already store -> job_id; keep job_id set.
  let items = [];
  try { const d = await getJSON(`${XANO}/get_office_kanban`); items = d.items || d.jobs || []; } catch (e) { return j(200, { ok: false, error: 'kanban load failed' }); }
  const numToJob = {};      // number -> job_id
  const jobIds = new Set();
  const jobNums = {};       // job_id -> Set(numbers)
  for (const jb of items) {
    const id = Number(jb.id); if (!id) continue;
    jobIds.add(id); jobNums[id] = jobNums[id] || new Set();
    for (const k of ['claim_number', 'dispatch_source_id']) {
      const v = String(jb[k] || '').trim();
      if (v) { numToJob[v] = id; jobNums[id].add(v); }
    }
  }

  // 2) MeisterTask cards across boards: link each card to a job (via any shared
  //    number), then attribute ALL the card's numbers to that job.
  let cardsScanned = 0, cardsMatched = 0;
  for (const key of BOARDS) {
    let cols = [];
    try {
      const d = await fetch(`https://tnapplianceexchange.net/.netlify/functions/mt-board?key=${key}`, { signal: AbortSignal.timeout(24000) }).then((r) => r.json());
      if (d && d.ok && Array.isArray(d.columns)) cols = d.columns;
    } catch (_) {}
    for (const col of cols) for (const cd of (col.cards || [])) {
      cardsScanned++;
      const toks = extractIds(cd.title);
      if (!toks.length) continue;
      let jid = 0;
      for (const t of toks) { if (numToJob[t]) { jid = numToJob[t]; break; } }
      if (!jid) continue;
      cardsMatched++;
      jobNums[jid] = jobNums[jid] || new Set();
      for (const t of toks) { jobNums[jid].add(t); numToJob[t] = jid; }
    }
  }

  // 3) Existing warranty_ids rows (dedupe — only write when we have NEW numbers).
  const existing = {};
  try {
    const d = await getJSON(`${XANO}/list_recent_event_log?action=warranty_ids&days_back=400&limit=1000`);
    const rows = (d && (d.items || d.rows)) || [];
    for (const r of rows) { const m = asObj(r.metadata); const id = Number(m.job_id || 0); if (id && !existing[id]) existing[id] = new Set((m.ids || []).map(String)); }
  } catch (_) {}

  // 4) Write one warranty_ids row per job whose id-set grew.
  const tok = process.env.XANO_METADATA_TOKEN;
  const toWrite = [];
  for (const id of Object.keys(jobNums)) {
    const nums = [...jobNums[id]];
    if (nums.length < 2) continue; // a single number adds nothing over what we already index
    const have = existing[id] || new Set();
    const isNew = nums.some((n) => !have.has(String(n)));
    if (isNew) toWrite.push({ job_id: Number(id), ids: nums });
  }
  const writes = toWrite.slice(0, MAX_WRITES);
  let written = 0;
  if (!dry && tok) {
    for (const w of writes) {
      try {
        const r = await fetch(`${META}/table/${EVENT_LOG}/content`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'warranty_ids', metadata: { job_id: w.job_id, ids: w.ids, source: 'meistertask_harvest', at_ms: Date.now() } }),
        });
        if (r.ok) written++;
      } catch (_) {}
    }
  }

  return j(200, {
    ok: true, mode: dry ? 'dryrun' : 'live',
    jobs_indexed: jobIds.size, cards_scanned: cardsScanned, cards_matched: cardsMatched,
    jobs_with_multi_ids: toWrite.length, written, capped: toWrite.length > MAX_WRITES,
    sample: writes.slice(0, 6),
  });
};
