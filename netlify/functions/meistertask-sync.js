// meistertask-sync — when a job lands in Ant, ALSO drop a card into Danielle's
// MeisterTask "NEEDS SCHEDULED" folder for the right state (TN or LA), so she can
// track + schedule it there like she always has. (Teddy 7/1: the SquareTrade
// breakdown email she used to copy into MeisterTask stopped reaching her.)
//
// Source = list_needs_scheduled_parallel (jobs that need scheduling, with the full
// customer breakdown). Forward-only (won't card the whole backlog) + idempotent
// (one card per job, tracked by a meistertask_card_created event).
//
//   GET ?dryrun=1[&secret=]   -> resolve sections + list candidates, create nothing
//   GET ?secret=<admin>       -> create cards now (also runs on schedule)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const mt = require('./_lib/meistertask');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
// Go-live moment (2026-07-01 ~2:49pm CT). Only jobs created at/after this get a
// card — everything before is already in MeisterTask.
const SYNC_SINCE_MS = 1782935338546;
const SCHEDULING_PROJECT = 1964382;   // Danielle's SCHEDULING board
const NOLA_PROJECT = 8806934;         // fallback for a LA needs-scheduled section
const DAY = 86400000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// The NEEDS SCHEDULED sections (verified live 7/1). Hardcoded so the live path
// spends ZERO MeisterTask read calls at startup — the rate-limit pace is tight,
// so we save the whole budget for the card creates.
const TN_SECTION = { id: 6405438, name: 'TN NEEDS SCHEDULED', project: SCHEDULING_PROJECT };
const LA_SECTION = { id: 29303912, name: 'NOLA NEED SCHEDULED', project: SCHEDULING_PROJECT };

// dryrun only: pull the live section list so we can eyeball routing.
async function listAllSections() {
  const out = [];
  for (const pid of [SCHEDULING_PROJECT, NOLA_PROJECT]) {
    try { const s = await mt.listSections(pid) || []; out.push(...s.map((x) => ({ id: x.id, name: String(x.name || ''), project: pid }))); } catch (_) {}
  }
  return out;
}

function isLA(st) { return /^(la|louisiana)$/i.test(String(st || '').trim()); }

function cardFor(job) {
  const name = `${(job.customer_first || '').trim()} ${(job.customer_last || '').trim()}`.trim() || 'Customer';
  const appl = [job.appliance, job.brand].filter(Boolean).join(' · ');
  const title = `${name} — ${appl || 'appliance'}${job.service_city ? ' · ' + job.service_city : ''}`;
  const phone = (job.customer_phone || '').replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  const addr = [job.service_address, job.service_city, job.service_state, job.service_zip].filter(Boolean).join(', ');
  const wc = (job.warranty_company || '').trim();
  const claim = (job.claim_number || '').trim();
  const lines = [
    (wc || claim) ? `**${wc || 'Warranty'}**${claim ? ' · Claim ' + claim : ''}` : '',
    phone ? `📞 ${phone}` : '',
    addr ? `📍 ${addr}` : '',
    (job.appliance || job.brand || job.model_number) ? `🔧 ${[job.appliance, job.brand, job.model_number].filter(Boolean).join(' · ')}` : '',
    job.problem_summary ? `📝 ${String(job.problem_summary).slice(0, 500)}` : '',
    `— Ant job #${job.id} · ${SITE}/job-detail.html?job_id=${job.id}`,
  ].filter(Boolean);
  return { name: title.slice(0, 250), notes: lines.join('\n') };
}

async function run({ dryrun }) {
  if (!(await mt.isConfigured())) return { ok: false, error: 'MEISTERTASK_TOKEN not in vault' };
  // Sections are hardcoded (verified live 7/1) so the live path spends zero
  // MeisterTask read calls at startup.
  const sec = { tn: TN_SECTION, la: LA_SECTION };

  // FORWARD-ONLY from go-live (Teddy 7/1: "we already have all the other jobs in
  // MeisterTask — only NEW jobs from now forward"). Every existing job was created
  // before this instant, so only jobs created AFTER it get a card. No backlog.
  const cutoff = Number(process.env.MEISTERTASK_SYNC_SINCE_MS) || SYNC_SINCE_MS;
  // Cap per run so we stay inside the function time budget (MeisterTask paces
  // ~1.1s/call). The 10-min schedule catches up any burst over a few runs.
  const CAP = Number(process.env.MEISTERTASK_SYNC_CAP) > 0 ? Number(process.env.MEISTERTASK_SYNC_CAP) : 5;

  // Candidate jobs (need scheduling) + already-carded markers.
  let items = [];
  try {
    const r = await fetch(`${XANO}/list_needs_scheduled_parallel?per_page=1000`, { signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    items = (d && (d.items || d.jobs)) || [];
  } catch (e) { return { ok: false, error: 'could not load needs-scheduled: ' + String(e.message || e) }; }

  let carded = new Set();
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'meistertask_card_created' }, { id: 'desc' }, 800);
    for (const r of rows) { const m = metaOf(r); if (m.job_id != null) carded.add(Number(m.job_id)); }
  } catch (_) {}

  const hasInfo = (it) => !!((it.customer_first || it.customer_last || '').trim() || (it.appliance || '').trim() || (it.service_address || '').trim());
  const fresh = items
    .filter((it) => Number(it.created_at || 0) >= cutoff)
    .filter((it) => !carded.has(Number(it.id)))
    .filter(hasInfo)  // skip truly-empty shells (no name/appliance/address)
    .sort((a, b) => Number(a.created_at) - Number(b.created_at));

  const todo = fresh.slice(0, CAP);
  const result = { ok: true, dryrun: !!dryrun, sections: { tn: sec.tn, la: sec.la }, candidates: fresh.length, capped_at: CAP, created: [], skipped_backlog: items.length - fresh.length - carded.size };

  if (dryrun) {
    result.preview = todo.map((it) => ({ job_id: it.id, state: it.service_state, section: (isLA(it.service_state) ? sec.la : sec.tn).name, title: cardFor(it).name }));
    try { result.all_sections = await listAllSections(); } catch (_) {}
    return result;
  }

  for (const it of todo) {
    const section = isLA(it.service_state) ? sec.la : sec.tn;
    try {
      const card = cardFor(it);
      const task = await mt.createTask(section.id, card);
      const taskId = task && (task.id || task.token) || null;
      await crud.logEvent('meistertask_card_created', { job_id: Number(it.id), task_id: taskId, section_id: section.id, state: it.service_state || '', at_ms: Date.now() });
      result.created.push({ job_id: it.id, section: section.name, task_id: taskId });
    } catch (e) {
      result.created.push({ job_id: it.id, error: String((e && e.message) || e) });
    }
  }
  result.created_count = result.created.filter((c) => !c.error).length;
  return result;
}

// Delete the cards created by earlier (timed-out test) runs, via their markers,
// so Danielle's board is clean. One-time: ?cleanup=1&secret=
async function cleanup() {
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'meistertask_card_created' }, { id: 'desc' }, 800); } catch (_) {}
  const out = { ok: true, deleted: [], count: 0 };
  for (const r of rows) {
    const m = metaOf(r);
    if (m.task_id == null) continue;
    try { await mt.deleteTask(m.task_id); await crud.logEvent('meistertask_card_deleted', { job_id: m.job_id, task_id: m.task_id, at_ms: Date.now() }); out.deleted.push({ job_id: m.job_id, task_id: m.task_id }); }
    catch (e) { out.deleted.push({ task_id: m.task_id, error: String(e.message || e) }); }
  }
  out.count = out.deleted.filter((d) => !d.error).length;
  return out;
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dryrun = q.dryrun === '1';
  const admin0 = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.cleanup === '1') {
    if (q.secret !== admin0) return j(401, { ok: false, error: 'secret required' });
    try { return j(200, await cleanup()); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }
  }
  if (!dryrun) {
    const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    // scheduled invocations have no query string; allow them. Manual needs the secret.
    const scheduled = !event.queryStringParameters && event.httpMethod === undefined;
    if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'pass ?secret= (or ?dryrun=1)' });
  }
  try { return j(200, await run({ dryrun })); }
  catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};
