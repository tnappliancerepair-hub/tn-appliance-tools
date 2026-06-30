// tdr-gap-watch — SAFETY NET for the "Ant took the report but it didn't land" gap.
//
// The Detrich Hebert case (job 20009, 2026-06-30): Andre called Ant, gave his
// whole report, Ant saved it as NOTES but left every structured TDR field blank
// AND never closed the job — so to the office it looked like nothing happened.
//
// This watcher finds those. For every job where a tech ACTUALLY WENT OUT
// (tech_en_route stamped) and a report was filed, it flags two failure modes:
//   1. INCOMPLETE TDR — notes exist but diagnosis or failed_component is empty
//      (warranty can't be submitted, auto-router skips it).
//   2. OPEN AFTER VISIT — tech went + filed, but the job is still scheduled/
//      in_progress (never marked complete / parts-needed / etc).
// Then it NUDGES the responsible tech (passive + encouraging: "finish the TDR
// and you're done") and digests the gaps to Teddy so nothing rots unseen.
//
// Pre-diagnosis TDRs (Teddy, tech 1, filed before any visit) are excluded
// automatically — the gate requires tech_en_route_at, which only stamps once a
// tech is actually rolling. Parts/held jobs aren't flagged "open" (legit states).
//
// Dedup per TDR id (one nudge each). Min age 45 min so a tech mid-job isn't nagged.
//
//   scheduled every 30 min (8a-8p CT)   nudge techs + digest Teddy
//   GET ?dry=1[&days=3]                  list gaps, send nothing
//   GET ?force=1                         ignore the CT business-hours gate
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TDR_TABLE = 12; // technician_decision_report
const TEDDY = '+16154855795';

// Tech roster — phones bypass the customer gate in send_sms. Andre = 504.
const TECH = {
  1: { p: '+16154855795', n: 'Teddy' }, 2: { p: '+16159671304', n: 'Jimmy' },
  3: { p: '+15049099413', n: 'Andre' }, 4: { p: '+16158291654', n: 'Lee' },
  6: { p: '+18133527686', n: 'John' },
};
// Job is legitimately "not open" in these states — don't flag OPEN_AFTER_VISIT.
const NOT_OPEN = new Set(['completed', 'canceled', 'cancelled', 'no_fix_possible', 'awaiting_parts', 'held', 'parts_ordered']);

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const blank = (v) => !String(v == null ? '' : v).trim();
async function getJson(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); return await r.json(); } catch (_) { return null; } }
function ctHour() { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dry === '1';
  const force = q.force === '1';
  if (!dry && !force) { const h = ctHour(); if (h < 8 || h >= 20) return json(200, { ok: true, skipped: 'outside 8a-8p CT', ct_hour: h }); }

  const days = Math.max(1, Math.min(7, parseInt(q.days, 10) || 3));
  const sinceMs = Date.now() - days * 86400000;
  const minAgeMs = 45 * 60000; // tech gets 45 min before we nag
  const now = Date.now();

  // Recent TDR submissions (newest first). create_tdr events carry job_id + tdr_id.
  let evs = [];
  try { evs = await crud.searchPage(crud.TABLES.event_log, { action: 'create_tdr' }, { id: 'desc' }, 150); }
  catch (e) { return json(200, { ok: false, error: 'event_log: ' + String(e.message || e) }); }

  // Latest TDR per job within the window, old enough to evaluate.
  const seenJob = new Set();
  const cand = [];
  for (const r of evs || []) {
    const m = meta(r);
    const jobId = Number(m.job_id || m.jobId || 0);
    const tdrId = Number(m.tdr_id || 0);
    const at = Number(m.at_ms || r.created_at || 0);
    if (!jobId || !tdrId) continue;
    if (at && at < sinceMs) continue;
    if (at && now - at < minAgeMs) continue; // too fresh
    if (seenJob.has(jobId)) continue;          // only the latest per job
    seenJob.add(jobId);
    cand.push({ ev_id: r.id, job_id: jobId, tdr_id: tdrId, at });
  }

  // Dedup — TDR ids already nudged.
  const done = new Set();
  try {
    const sent = await crud.searchPage(crud.TABLES.event_log, { action: 'tdr_gap_nudged' }, { id: 'desc' }, 120);
    for (const r of sent || []) { for (const id of (meta(r).tdr_ids || [])) done.add(Number(id)); }
  } catch (_) {}

  const gaps = [];
  for (const c of cand.slice(0, 30)) {
    if (done.has(c.tdr_id)) continue;
    const job = await getJson(`${XANO}/get_job?job_id=${c.job_id}`);
    if (!job || !job.id) continue;
    // Gate: a tech actually went out (excludes pre-diagnosis filed before any visit).
    const wentOut = !!(job.tech_en_route_at || job.job_started_at);
    if (!wentOut) continue;

    // Fetch the TDR row to read structured fields.
    let tdr = null;
    try { tdr = (await crud.searchPage(TDR_TABLE, { id: c.tdr_id }, null, 1))[0] || null; } catch (_) {}
    if (!tdr) continue;

    const incomplete = blank(tdr.diagnosis) || blank(tdr.failed_component);
    const status = String(job.scheduling_status || '').toLowerCase();
    const open = !NOT_OPEN.has(status);
    if (!incomplete && !open) continue; // all good

    const missing = [];
    if (blank(tdr.diagnosis)) missing.push('diagnosis');
    if (blank(tdr.failed_component)) missing.push('part/component');
    if (blank(tdr.failure_cause)) missing.push('cause');
    if (blank(tdr.repair_completed)) missing.push('repair/2nd-visit');

    const tid = Number(tdr.technician_id || job.technician_id || 0);
    gaps.push({
      job_id: c.job_id, tdr_id: c.tdr_id, tech_id: tid, tech: (TECH[tid] && TECH[tid].n) || ('tech ' + tid),
      appliance: [job.brand, job.appliance_type].filter(Boolean).join(' ') || 'appliance',
      warranty: String(job.customer_type || '') === 'warranty' ? (job.warranty_company || 'warranty') : '',
      status, incomplete, open, missing,
      has_notes: !blank(tdr.technician_notes),
    });
  }

  const out = { ok: true, dry, scanned: cand.length, gaps_found: gaps.length };
  if (dry) { out.gaps = gaps; return json(200, out); }
  if (!gaps.length) { out.note = 'no TDR gaps — nothing sent'; return json(200, out); }

  // Nudge the responsible tech (passive + encouraging).
  const texted = [];
  for (const g of gaps) {
    const t = TECH[g.tech_id];
    const link = `${SITE}/tech-job.html?job_id=${g.job_id}&tech_id=${g.tech_id}`;
    let body;
    if (g.incomplete && g.open) {
      body = `Quick one on job #${g.job_id} (${g.appliance}) — your report came in 🙌 but the TDR's still missing ${g.missing.join(', ')} and the job's not closed out. Finish it here and you're done: ${link}`;
    } else if (g.incomplete) {
      body = `Almost there on job #${g.job_id} (${g.appliance}) — report's in, just need ${g.missing.join(', ')} on the TDR to wrap it. Tap here: ${link}`;
    } else {
      body = `Job #${g.job_id} (${g.appliance}) — TDR looks good, just need you to hit Complete so it closes out. ${link}`;
    }
    let ok = false;
    if (t && t.p) ok = await sendSms(t.p, body, 'technician', 'tdr_gap');
    texted.push({ job: g.job_id, tech: g.tech, sms: t && t.p ? (ok ? 'sent' : 'failed') : 'no_phone' });
  }

  // Digest to Teddy so the pattern surfaces (these were invisible before).
  const line = (g) => `#${g.job_id} ${g.appliance}${g.warranty ? ' (' + g.warranty + ')' : ''} — ${g.tech}: ${[g.incomplete ? 'TDR missing ' + g.missing.join('/') : '', g.open ? 'job still open' : ''].filter(Boolean).join(' + ')}`;
  const digest = `🩹 ${gaps.length} TDR gap${gaps.length === 1 ? '' : 's'} caught (report filed but didn't fully land):\n` + gaps.map(line).join('\n') + `\nTechs nudged. Board: ${SITE}/office-board.html`;
  let teddy = false;
  try { teddy = await sendSms(TEDDY, digest, 'owner', 'tdr_gap_digest'); } catch (_) {}

  try { await crud.logEvent('tdr_gap_nudged', { tdr_ids: gaps.map((g) => g.tdr_id), job_ids: gaps.map((g) => g.job_id), count: gaps.length, texted, teddy, at_ms: Date.now() }); } catch (_) {}

  out.texted = texted; out.teddy_digest = teddy;
  out.summary = `${gaps.length} gap(s) · tech texts: ${texted.filter((t) => t.sms === 'sent').length} sent · Teddy digest ${teddy ? 'sent' : 'FAILED'}`;
  return json(200, out);
};
