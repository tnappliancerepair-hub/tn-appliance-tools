// tech-prep-link — THE ONE tech text (Teddy 2026-07-24): the moment a job has a tech
// assigned, send THAT tech the Teddy Tool pre-diagnosis link so they can call the
// customer, get a video, and prep the job (a good video can save the whole trip).
// Nothing else — no other tech texts. Secondary texts get added later, one at a time.
//
// WHY A SWEEP (not the signal path): the main way Danielle assigns a job
// (danielle_schedule_parallel_job) never emits TECH_ASSIGNED, and the loop's tech texts
// fire from the dead 757-5500 number. So instead of fixing three fragile Mac-side things,
// this watches the live board for "job has a tech + is active + not yet notified" and
// sends ONE prep text from the APPROVED line that actually delivers. Catches every
// assignment path (Danielle, reassign, HCP, whatever) because it reads job STATE, not a
// signal. Forward-only + deduped + per-run cap + business-hours so it can never spam.
//
//   GET ?probe=1                         -> who WOULD get it right now (no send)
//   GET ?baseline=1&secret=<admin>       -> mark all current jobs as done, send NOTHING
//                                           (run ONCE so only NEW jobs get texted going forward)
//   GET ?test=<e164>&secret=<admin>      -> send ONE sample text to that number (eyeball it)
//   GET ?live=1&secret=<admin>           -> actually send this run
//   Scheduled cron -> sends only if env TECH_PREP_LINK_LIVE=true (else dry/no-op)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TELNYX = 'https://api.telnyx.com/v2';
const SITE = 'https://tnapplianceexchange.net';
const TECHNICIANS = crud.TABLES.technicians; // 15
const EVENT_LOG = crud.TABLES.event_log;

const TERMINAL = new Set(['completed', 'complete', 'canceled', 'cancelled', 'done', 'closed', 'no_fix_possible', 'not_needed']);
const PER_RUN_CAP = 12;
const RECENT_MS = 5 * 86400000; // created within 5 days OR scheduled in the future

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (!d) return ''; if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return d.startsWith('+') ? d : '+' + d; }
function ctHour() { try { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10) || 0; } catch (_) { return 12; } }

async function techPhones() {
  const map = {};
  try {
    const rows = (await crud.searchPage(TECHNICIANS, {}, { id: 'asc' }, 100)) || [];
    for (const t of rows) { const ph = e164(t.phone); if (ph) map[Number(t.id)] = { phone: ph, name: t.first_name || t.name || ('Tech ' + t.id), active: t.active !== false }; }
  } catch (_) {}
  return map;
}

// Jobs already texted -> Set of "jobId:techId"
async function alreadySent() {
  const seen = new Set();
  try {
    const rows = (await crud.searchPage(EVENT_LOG, { action: 'tech_prep_link_sent' }, { id: 'desc' }, 500)) || [];
    for (const r of rows) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } m = m || {}; if (m.job_id && m.technician_id) seen.add(Number(m.job_id) + ':' + Number(m.technician_id)); }
  } catch (_) {}
  return seen;
}

async function boardJobs() {
  try { const r = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(15000) }); const d = await r.json(); return (Array.isArray(d) ? d : (d.jobs || d.items || d.rows || [])) || []; }
  catch (_) { return []; }
}

function qualifies(j, now) {
  const tid = Number(j.technician_id || 0);
  if (!tid || tid === 1) return false;                                  // no tech, or owner (Teddy already gets it)
  if (TERMINAL.has(String(j.scheduling_status || '').toLowerCase())) return false;
  const created = Number(j.created_at || 0);
  const sched = Number(j.scheduled_start || 0);
  const recent = (created && now - created <= RECENT_MS) || (sched && sched >= now - 43200000); // 5d old OR upcoming/today
  return !!recent;
}

function composeText(j) {
  const first = (j.customer_first || '').trim() || 'the customer';
  const appl = (j.appliance_type || j.appliance || 'appliance').toString().trim();
  const city = (j.service_city || '').trim();
  const where = city ? ` (${city})` : '';
  const link = `${SITE}/teddy-tdr-tool.html?job_id=${j.id}`;
  return `🔧 New job #${j.id} — ${first} · ${appl}${where}\nCall or text them for a quick video before you roll — a good one can save the trip. Prep it: ${link}`;
}

async function sendTelnyx(from, to, text) {
  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return { sent: false, err: 'no_telnyx_key' };
  try {
    const r = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, text }), signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ({}));
    return { sent: r.ok, id: (d.data && d.data.id) || null, err: r.ok ? null : JSON.stringify(d.errors || d).slice(0, 200) };
  } catch (e) { return { sent: false, err: String((e && e.message) || e) }; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const scheduled = !!(event && event.body && (() => { try { return JSON.parse(event.body).next_run; } catch (_) { return false; } })());
  const FROM = (await getSecret('TECH_PREP_FROM')) || '+16158578800';   // approved line; swap to a dedicated # later w/o code change

  // sample text for a probe (no data needed)
  const now = Date.now();
  const techs = await techPhones();
  const sent = await alreadySent();
  const jobs = (await boardJobs()).filter((j) => qualifies(j, now));

  // Build the work list (dedup + resolvable, active tech phone)
  const work = [];
  for (const j of jobs) {
    const tid = Number(j.technician_id);
    const key = Number(j.id) + ':' + tid;
    if (sent.has(key)) continue;
    const t = techs[tid];
    if (!t || !t.phone || t.active === false) continue;
    work.push({ job: j, tid, phone: t.phone, name: t.name, text: composeText(j) });
  }

  // ── one-off test send to a phone (eyeball the exact text) ─────────────
  if (q.test) {
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
    const sampleJob = (jobs[0]) || { id: 20000, customer_first: 'Sample', appliance_type: 'Dryer', service_city: 'Nashville' };
    const res = await sendTelnyx(FROM, e164(q.test), composeText(sampleJob));
    return json(200, { ok: res.sent, test: true, to: e164(q.test), from: FROM, sample_text: composeText(sampleJob), result: res });
  }

  // ── baseline: mark everything current as done, send nothing (forward-only reset) ──
  if (q.baseline) {
    if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
    let marked = 0;
    for (const w of work) { try { await crud.logEvent('tech_prep_link_sent', { job_id: Number(w.job.id), technician_id: w.tid, baseline: true, at_ms: Date.now() }); marked++; } catch (_) {} }
    return json(200, { ok: true, baseline: true, marked, note: 'current assigned jobs marked as sent — only NEW jobs get texted from now on' });
  }

  // ── decide whether to actually send ───────────────────────────────────
  const liveEnv = String((await getSecret('TECH_PREP_LINK_LIVE')) || '').toLowerCase() === 'true';
  const live = q.live === '1' ? (q.secret === admin) : (scheduled && liveEnv);
  const hourOk = ctHour() >= 7 && ctHour() < 21;

  if (!live) {
    return json(200, { ok: true, mode: 'dry', would_send: work.length, from: FROM, hour_ct: ctHour(),
      preview: work.slice(0, 8).map((w) => ({ job_id: w.job.id, tech: w.name, to: w.phone, text: w.text })),
      note: work.length ? 'DRY RUN — nothing sent. Add ?live=1&secret= to send, or set TECH_PREP_LINK_LIVE=true for the cron.' : 'no jobs pending a prep text right now' });
  }
  if (!hourOk) return json(200, { ok: true, mode: 'live', skipped: 'outside 7am-9pm CT', hour_ct: ctHour(), would_send: work.length });

  // ── send (capped) ─────────────────────────────────────────────────────
  const results = [];
  for (const w of work.slice(0, PER_RUN_CAP)) {
    const res = await sendTelnyx(FROM, w.phone, w.text);
    if (res.sent) { try { await crud.logEvent('tech_prep_link_sent', { job_id: Number(w.job.id), technician_id: w.tid, to: w.phone, provider_id: res.id, at_ms: Date.now() }); } catch (_) {} }
    results.push({ job_id: w.job.id, tech: w.name, to: w.phone, sent: res.sent, err: res.err || undefined });
  }
  return json(200, { ok: true, mode: 'live', from: FROM, pending: work.length, sent_this_run: results.filter((r) => r.sent).length, capped_at: PER_RUN_CAP, results });
};
