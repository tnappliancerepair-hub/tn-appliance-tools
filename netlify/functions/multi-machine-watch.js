// multi-machine-watch — catch AHS/Frontdoor multi-item claims that only created ONE
// machine. A single dispatch often covers several appliances (Floyd Tribble: washer +
// dryer + cooktop on one claim), but the intake only ever builds ONE job, so the other
// appliances get stranded in the problem text — no TDR, no warranty submit, invisible on
// the board. This sweeps recent warranty jobs, detects the FULL set of appliances named,
// and (auto or flag) fills in the missing machines as linked siblings on the same stop —
// exactly what the tech's "＋ Add machine" does, so each gets its own TDR/warranty/parts.
//
// Precision-first: only fires when >=2 distinct appliances are named AND there's a real
// multi-item cue (an explicit phrase like "multiple appliances"/"all three", OR each
// appliance sits next to a repair symptom). A lone "the washer is by the dryer" won't trip.
//
//   GET ?secret=<admin>                       -> DRY RUN over the recent window
//   GET ?secret=<admin>&job_id=20592          -> DRY RUN a single job
//   GET ?secret=<admin>&confirm=1             -> LIVE: add the missing machines
//   GET ?secret=<admin>&days=21&limit=50      -> tune lookback / cap
//   (Netlify cron sends {next_run}: self-authorizes, runs LIVE if MULTI_MACHINE_AUTOADD=true,
//    else DRY+flag — always alerts Danielle on anything it adds/flags.)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const SITE = 'https://tnapplianceexchange.net';
const DANIELLE = '+16154850713';
exports.config = { timeout: 60 };

function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
function hdr() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('XANO_METADATA_TOKEN not set'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }

// ── Appliance detection ──────────────────────────────────────────────────────
// Canonical type -> the words that name it. Order matters (check refrigerator's
// "freezer"/"ice maker" etc.). Each canonical maps to the label add-machine wants.
const TYPES = [
  { canon: 'refrigerator', label: 'Refrigerator', words: ['refrigerator', 'fridge', 'freezer', 'ice maker', 'icemaker'] },
  { canon: 'washer', label: 'Washer', words: ['washer', 'washing machine', 'clothes washer'] },
  { canon: 'dryer', label: 'Dryer', words: ['dryer'] }, // "hair dryer" filtered below
  { canon: 'dishwasher', label: 'Dishwasher', words: ['dishwasher', 'dish washer'] },
  { canon: 'range', label: 'Cooktop Or Range', words: ['cooktop', 'stove', 'range', 'oven', 'wall oven'] },
  { canon: 'microwave', label: 'Microwave', words: ['microwave'] },
];
// Whole-word matcher — \b stops "washer" from matching inside "dishwasher" and
// "range" inside "orange". Returns the match index (or -1).
function wordPos(text, word) {
  const m = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').exec(text);
  return m ? m.index : -1;
}
// Map whatever appliance_type a job already carries onto a canonical bucket.
// Check dishwasher before washer so "dishwasher" never buckets as washer.
function canonOf(s) {
  const t = String(s || '').toLowerCase();
  if (!t) return '';
  if (wordPos(t, 'dishwasher') >= 0 || t.includes('dish washer')) return 'dishwasher';
  for (const ty of TYPES) for (const w of ty.words) if (wordPos(t, w) >= 0) {
    if (ty.canon === 'dryer' && t.includes('hair dryer')) continue;
    return ty.canon;
  }
  return '';
}
const SYMPTOM = /\b(repair|repaired|fix|fixed|broke|broken|not\s|won'?t|wont|replace|replaced|issue|problem|leak|noise|error|button|monitor|belt|flapper|element|compressor|pump|cool|heat|drain|spin)\b/i;
const MULTI_CUE = /\b(multiple appliances|all three|all 3|all four|both appliances|two appliances|2 appliances|three appliances|3 appliances|each appliance|other appliance|second appliance|additional appliance|and (?:a|an|the) (?:washer|dryer|refrigerator|fridge|freezer|dishwasher|cooktop|stove|range|oven|microwave)|as well as|also needs?)\b/i;

// Return the set of canonical appliance types named in the text, but only with a
// multi-item cue (keeps precision high in an automated sweep).
function detect(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return { types: [], hits: [] };
  const hasDishwasher = wordPos(t, 'dishwasher') >= 0 || t.includes('dish washer');
  const found = [];
  for (const ty of TYPES) {
    let pos = -1;
    for (const w of ty.words) {
      const i = wordPos(t, w);
      if (i < 0) continue;
      if (ty.canon === 'dryer' && t.slice(Math.max(0, i - 5), i).includes('hair')) continue;
      pos = i; break;
    }
    // a standalone "washer" hit that is really just the tail of "dishwasher" — skip
    // when the only washer evidence is the dishwasher word.
    if (ty.canon === 'washer' && pos >= 0 && hasDishwasher && wordPos(t, 'washer') < 0 && wordPos(t, 'washing machine') < 0 && wordPos(t, 'clothes washer') < 0) pos = -1;
    if (pos >= 0) found.push({ canon: ty.canon, label: ty.label, pos });
  }
  if (found.length < 2) return { types: [], hits: found };
  // Symptom-adjacency: an appliance word within ~45 chars of a symptom word.
  const symptomAdj = found.filter((f) => SYMPTOM.test(t.slice(Math.max(0, f.pos - 45), f.pos + 45)));
  const cue = MULTI_CUE.test(t);
  if (!cue && symptomAdj.length < 2) return { types: [], hits: found }; // not confident enough
  const uniq = []; const seen = new Set();
  for (const f of found) if (!seen.has(f.canon)) { seen.add(f.canon); uniq.push(f); }
  return { types: uniq, hits: found, cue, symptomAdj: symptomAdj.length };
}

async function pullRecentJobs(days, hardCap) {
  const cutoff = Date.now() - days * 86400000;
  const out = []; const PER = 200;
  for (let p = 1; p <= 40; p++) {
    const r = await fetch(`${META}/table/${crud.TABLES.jobs}/content/search`, { method: 'POST', headers: hdr(), body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }) });
    if (!r.ok) break;
    const j = await r.json().catch(() => ({}));
    const items = j.items || [];
    for (const it of items) out.push(it);
    const oldest = items.length ? items[items.length - 1] : null;
    const createdMs = oldest && (Number(oldest.created_at) || Date.parse(oldest.created_at) || 0);
    if (items.length < PER || (createdMs && createdMs < cutoff) || out.length >= hardCap) break;
  }
  return out;
}

async function machinesOnStop(jobId) {
  const r = await fetch(`${SITE}/.netlify/functions/get-stop-machines?job_id=${jobId}`);
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const autoEnv = String(process.env.MULTI_MACHINE_AUTOADD || '').toLowerCase() === 'true';
  const live = q.confirm === '1' || (scheduled && autoEnv);
  const days = Math.min(parseInt(q.days, 10) || 21, 120);
  const cap = Math.min(parseInt(q.limit, 10) || 400, 2000);

  // Candidate set
  let candidates = [];
  try {
    if (q.job_id) {
      const one = await crud.searchOne(crud.TABLES.jobs, { id: parseInt(q.job_id, 10) });
      if (one) candidates = [one];
    } else {
      const jobs = await pullRecentJobs(days, cap);
      const TERMINAL = new Set(['canceled', 'cancelled', 'completed', 'no_fix_possible']);
      candidates = jobs.filter((j) => {
        const warranty = String(j.customer_type || '').toLowerCase() === 'warranty' || String(j.claim_number || '').trim() || String(j.warranty_company || '').trim();
        const alive = !TERMINAL.has(String(j.scheduling_status || '').toLowerCase());
        return warranty && alive;
      });
    }
  } catch (e) { return json(200, { ok: false, error: 'candidate read failed: ' + String((e && e.message) || e) }); }

  const flagged = []; let added = 0, addFailed = 0, alerted = 0;
  for (const job of candidates) {
    const text = [job.problem_summary, job.notes_internal, job.problem_description, job.appliance_type].filter(Boolean).join('  ||  ');
    const det = detect(text);
    if (!det.types.length) continue;

    const stop = await machinesOnStop(job.id);
    if (!stop || !stop.ok) continue;
    // Only act from the PRIMARY machine of the stop (avoid double-processing siblings).
    const me = (stop.machines || []).find((m) => Number(m.job_id) === Number(job.id));
    if (me && me.is_primary === false) continue;

    const existing = new Set((stop.machines || []).map((m) => canonOf(m.appliance)).filter(Boolean));
    const missing = det.types.filter((t) => !existing.has(t.canon));
    if (!missing.length) continue;

    const rec = { stop_id: stop.stop_id, primary_job: job.id, customer: [job.service_address].filter(Boolean).join(''), claim: job.claim_number || '', existing: [...existing], missing: missing.map((m) => m.label), evidence: (det.cue ? 'phrase-cue' : 'symptom-adjacent'), added: [] };

    if (live) {
      for (const m of missing) {
        try {
          const r = await fetch(`${SITE}/.netlify/functions/add-machine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent_job_id: stop.stop_id, appliance_type: m.label, brand: job.brand || '', problem: 'Added by multi-item AHS auto-detect (same claim ' + (job.claim_number || '') + ')', added_by: 'multi-machine-watch' }) });
          const jr = await r.json().catch(() => ({}));
          if (jr && jr.ok) { added++; rec.added.push({ label: m.label, job: jr.machine_job_id }); } else { addFailed++; }
        } catch (_) { addFailed++; }
      }
    }
    try { await crud.logEvent(live ? 'multi_machine_autoadded' : 'multi_machine_suggested', rec); } catch (_) {}
    flagged.push(rec);
  }

  // Alert Danielle once per run when anything was found (names the jobs — she can undo).
  if (flagged.length && (live || scheduled || q.job_id)) {
    const lines = flagged.slice(0, 8).map((f) => 'job #' + f.primary_job + ' (' + (f.claim || 'no claim') + '): ' + (live ? 'added ' : 'missing ') + f.missing.join(', '));
    const verb = live ? ('added ' + added + ' missing machine' + (added === 1 ? '' : 's')) : (flagged.length + ' multi-item job' + (flagged.length === 1 ? '' : 's') + ' need extra machines');
    const body = '[ant] multi-item claims — ' + verb + ':\n' + lines.join('\n') + '\n' + SITE + '/office-board.html';
    try { await sendSms(DANIELLE, body, 'office', 'multi_machine'); alerted = 1; } catch (_) {}
  }

  return json(200, {
    ok: true,
    mode: live ? 'LIVE — added missing machines' : 'DRY RUN (add &confirm=1 to write)',
    scanned: candidates.length,
    multi_item_jobs: flagged.length,
    machines_added: added, add_failed: addFailed, danielle_alerted: !!alerted,
    detail: flagged.slice(0, 40),
  });
};
