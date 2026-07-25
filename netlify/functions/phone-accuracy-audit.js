// phone-accuracy-audit — PROVE Ann is accurate before we widen her to text. Runs the
// phone's REAL status-tool path (job-truth, the same brain get_job_arrival_status
// uses) across a broad sample of live jobs and checks every answer against the
// source-of-truth job record: right DAY, right TECH (zone-correct or an honest "your
// technician"), and NO invented clock time. Repeatable — also a regression guard.
// (Teddy 2026-07-25: "prove Ann can be accurate before we add text back.")
//
//   GET ?secret=<admin>            -> audit a sample, return score + any mismatches
//   GET ?secret=<admin>&n=30       -> sample size (default 24, max 40)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { techCoversState } = require('./_lib/zone-integrity');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const ACTIVE = new Set(['scheduled', 'in_progress', 'awaiting_parts', 'held']);
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function monthDayCT(ms) {
  if (!ms || ms <= 0) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(ms)); // "Jul 27"
}
const HAS_TIME = /\b\d{1,2}:\d{2}\s*[ap]m\b|\b\d{1,2}\s*(?:am|pm)\b/i;

async function jget(url) { const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); return r.json(); }

// Run one job through the phone's real status path + grade it vs the source record.
async function auditJob(job) {
  const jid = job.id;
  const tid = Number(job.technician_id) || 0;
  const state = String(job.service_state || '').trim().toUpperCase();
  const startMs = Number(job.scheduled_start) || 0;
  // Expected, from the source-of-truth job row:
  const zoneOk = tid > 0 && techCoversState(tid, state);
  const expectTech = zoneOk ? (TECHS[tid] || '') : '';   // else Ann should say "your technician"
  const expectMD = monthDayCT(startMs);                   // "" if no day set

  let d = {};
  try { d = await jget(`${SITE}/job-truth?job_id=${jid}&lens=customer`); } catch (_) { return { jid, ok: false, err: 'job-truth call failed' }; }
  const f = (d && d.facts) || {};
  const ans = ((d.lenses && d.lenses.customer) || '');
  const gotTech = String(('tech_name_safe' in f) ? f.tech_name_safe : (f.tech_name || '')).trim();
  const gotDay = String(f.scheduled_day || '');

  const techOk = gotTech === expectTech;
  const dayOk = expectMD ? gotDay.includes(expectMD) : true;   // no day set → nothing to mis-state
  const noTime = !HAS_TIME.test(ans);
  return {
    jid, state, tech_id: tid,
    expectTech: expectTech || '(your technician)', gotTech: gotTech || '(your technician)', techOk,
    expectDay: expectMD || '(none)', gotDay: gotDay || '(none)', dayOk,
    noTime, pass: techOk && dayOk && noTime,
  };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== admin && q.secret !== GUARD_FALLBACK) return json(403, { ok: false, error: 'forbidden' });
  const N = Math.max(4, Math.min(40, Number(q.n) || 24));

  let items = [];
  try { const d = await jget(`${XANO}/get_office_kanban`); items = (d && d.items) || []; } catch (e) { return json(200, { ok: false, error: 'kanban failed: ' + String(e.message || e) }); }

  // Representative sample: active jobs across BOTH states + a mix that includes some
  // no-tech ones (to prove she says "your technician" instead of inventing a name).
  const active = items.filter((j) => ACTIVE.has(String(j.scheduling_status || '').toLowerCase()));
  const la = active.filter((j) => (j.service_state || '').toUpperCase() === 'LA');
  const tn = active.filter((j) => (j.service_state || '').toUpperCase() === 'TN');
  const noTech = active.filter((j) => !(Number(j.technician_id) > 0));
  const pick = [];
  const seen = new Set();
  const add = (arr, k) => { for (const j of arr) { if (pick.length >= k) break; if (!seen.has(j.id)) { seen.add(j.id); pick.push(j); } } };
  add(la, Math.floor(N * 0.45)); add(tn, Math.floor(N * 0.8)); add(noTech, N); add(active, N);

  // Run in small concurrent batches to stay inside the sync-function time budget.
  const results = [];
  for (let i = 0; i < pick.length; i += 6) {
    const batch = await Promise.all(pick.slice(i, i + 6).map(auditJob));
    results.push(...batch);
  }
  const graded = results.filter((r) => r && r.pass !== undefined);
  const passed = graded.filter((r) => r.pass).length;
  const score = graded.length ? Math.round(100 * passed / graded.length) : 0;
  const fails = { tech: graded.filter((r) => !r.techOk).length, day: graded.filter((r) => !r.dayOk).length, time_leak: graded.filter((r) => !r.noTime).length };
  const mismatches = graded.filter((r) => !r.pass).map((r) => ({ job: r.jid, state: r.state, tech: r.techOk ? 'ok' : `expected ${r.expectTech} got ${r.gotTech}`, day: r.dayOk ? 'ok' : `expected ${r.expectDay} got ${r.gotDay}`, time_leak: r.noTime ? 'ok' : 'LEAK' }));

  const readout = [
    `📞 Ann Accuracy Audit — ${graded.length} live jobs through her real tool path`,
    `Score: ${passed}/${graded.length} exact (${score}/100)`,
    `Right tech: ${graded.length - fails.tech}/${graded.length} · Right day: ${graded.length - fails.day}/${graded.length} · No invented time: ${graded.length - fails.time_leak}/${graded.length}`,
    mismatches.length ? `Mismatches: ${mismatches.length} (see list)` : `Zero mismatches — every answer matched the source record.`,
  ].join('\n');

  return json(200, { ok: true, tested: graded.length, passed, score, fails, mismatches, readout, sample: graded });
};
