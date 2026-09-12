// platform-intake-split-watch — a warranty dispatch often covers TWO appliances and lands as
// ONE job. This reads the intake text of recent jobs and FLAGS the ones that look like more
// than one machine. It does not create anything.
//
// ⚠️ FLAG BEFORE CREATE, and in v1 there is no create path here at all. The Xano-side
// appliance-split INVENTS a sibling job from problem text; measured against 90 days of real
// platform intake, a naive version of that rule would have been wrong roughly three times out
// of four (see _lib/multi-appliance for the five traps and the row that produced each). A
// phantom machine sits on the board as work nobody is servicing, carries its own claim, and
// shows on the customer's portal. A flag costs one tap.
//
// The human tap that DOES create is the ＋ Add machine button already live on
// platform/tech-job.html — proven, side-effect-free, and the same path a tech uses when he
// finds a second machine at the door. Nothing new to trust.
//
// Volume, measured: ~11 genuine candidates in 90 days. About one a week. That is exactly the
// shape a human clears instantly and an auto-creator ruins.
//
// The flag is an `event` row so there is no schema change and nothing can clobber a human's
// text: type multi_appliance_suspected, payload { job_id, primary, extra[], text }.
// A tech adding the machine, or anyone dismissing it, writes multi_appliance_resolved and the
// flag stops being offered.
//
// ⚠️ A LAUNDRY CENTER IS NOT TWO MACHINES, AND THE TEXT CANNOT TELL YOU. Of the first 17
// live flags, FIVE were one cabinet holding a washer and a dryer — the ticket names one half
// and the complaint names the other, which reads exactly like a wrong-machine ticket.
// SquareTrade's own claim record calls them "COMBO WASHER DRYER" and PAID every one. So the
// evidence has to come from the MODEL (mirrored already) or the vendor's product string
// (vendor_product_known, written by platform-vendor-product-sync) — never from the words.
// This also RETIRES a flag it can no longer stand behind: the system withdrawing its own
// claim, written as multi_appliance_resolved, never as an edit to the job.
//
// ⚠️ A MACHINE WE ADDED OURSELVES CARRIES ITS OWN ANSWER. ＋ Add machine writes
// `<Appliance> — added at the stop` into the problem text — the appliance the TECH picked
// standing in front of it. 74 of 77 added machines on this board still agree with that
// sentence; the three that don't are a mistyped ticket label, and the MODEL says which side
// drifted. Those get `added_machine_label`, which names declared vs labelled vs model instead
// of asking the vague "is this the right machine?", and REPLACES a vague flag already
// standing on the same job. It never picks the winner — on job 21590 the declared machine
// and the model genuinely disagree, and guessing is how a tech gets sent out blind.
// Added machines are also checked INSIDE a linked stop (the only scan that ignores
// stop_id=is.null), because a wrong label is invisible to the linker — 21590 linked cleanly.
//
//   GET ?secret=<admin>            shadow — what it WOULD flag
//   GET ?secret=<admin>&apply=1    write the flags
//   GET ?secret=<admin>&days=N     window (default 45; 0 = all)
//   Kill switch: vault PLATFORM_INTAKE_SPLIT_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { detect, addedAtStop, modelAppliance } = require('./_lib/multi-appliance');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const FLAG = 'multi_appliance_suspected';
const RESOLVED = 'multi_appliance_resolved';
// the vendor's own product string for a dispatch, mirrored in by platform-vendor-product-sync
const VENDOR = 'vendor_product_known';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function runIntakeSplit(opts) {
  const o = opts || {};
  const apply = !!o.apply;
  // the query string hands days over as a STRING, so `=== 0` never matches — same bug that
  // silently turned days=0 into the default in platform-stop-link.
  const dRaw = o.days;
  const days = (dRaw === undefined || dRaw === null || dRaw === '') ? 45 : (parseInt(dRaw, 10) || 0);

  const enabled = String((await getSecretFresh('PLATFORM_INTAKE_SPLIT_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (apply && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_INTAKE_SPLIT_ENABLED=false' };

  const base = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const SB = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  async function page(path) {
    const out = [];
    for (let from = 0; from < 20000; from += 1000) {
      let rows = [];
      try {
        const r = await fetch(`${base}/rest/v1/${path}`, {
          headers: Object.assign({ Range: `${from}-${from + 999}` }, SB), signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) return null;
        rows = await r.json().catch(() => []);
      } catch (_) { return null; }
      if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows);
      if (rows.length < 1000) break;
      if (from + 1000 >= 20000) return null;
    }
    return out;
  }

  // ⚠️ DO NOT window this on created_at. On this table created_at is the MIRROR's write time,
  // not when the job came in — measured 2026-09-12, every unlinked non-canceled TN job showed
  // a created_at inside 9 days, so days=21 and days=90 scanned the identical 1,662 rows. A
  // knob that silently does nothing is worse than no knob.
  // The window that means something is the appointment: recent work, PLUS everything not yet
  // scheduled — fresh intake with no day on it is exactly what we most want to flag, before a
  // tech is ever sent.
  const sel = 'id,problem,status,source,claim_number,scheduled_day,created_at,stop_id,unit:unit_id(label,attributes)';
  let f = `job?company_id=eq.${TN_COMPANY}&stop_id=is.null&status=neq.canceled&select=${encodeURIComponent(sel)}&order=id.asc`;
  if (days) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    f += `&or=(scheduled_day.is.null,scheduled_day.gte.${since})`;
  }
  const jobs = await page(f);
  if (!jobs) return { ok: false, error: 'platform_read_incomplete — refusing to flag off a short read' };

  // ⚠️ stop_id=is.null is right for "is there a second machine here" — a linked stop has
  // already had its machines sorted out. It is WRONG for "is this machine labelled as itself".
  // Job 21590 is the proof: a tech added a second dryer at the door, the ticket got labelled
  // "Electrolux washer" with a Whirlpool WASHER model on it, the linker was happy because that
  // read as a distinct appliance — and nothing anywhere asked the question. So added machines
  // get a second, deliberately narrow pass that ignores the stop filter and can ONLY ever
  // produce added_machine_label. It can never claim a second machine.
  let addedInStop = [];
  if (jobs) {
    const got = new Set(jobs.map((j) => String(j.id)));
    const extra = await page(`job?company_id=eq.${TN_COMPANY}&stop_id=not.is.null&status=neq.canceled&problem=ilike.${encodeURIComponent('%added at the stop%')}&select=${encodeURIComponent(sel)}&order=id.asc`);
    if (extra === null) return { ok: false, error: 'added_machine_read_incomplete — refusing to judge off a short read' };
    addedInStop = extra.filter((j) => !got.has(String(j.id)));
  }

  // already flagged / already dealt with — never offer the same machine twice
  const seen = new Set();     // has a live flag
  const done = new Set();     // a human (or this sweep) already settled it
  // ⚠️ ORDER BY created_at, NOT id. `event.id` is a UUID — ordering by it is ordering by a
  // random number, which reads as sorted and is not. liveKind below is last-write-wins, so a
  // meaningless sort would have made "is a flag standing right now" a coin flip.
  const evs = await page(`event?company_id=eq.${TN_COMPANY}&type=in.(${FLAG},${RESOLVED},${VENDOR})&select=type,payload,created_at&order=created_at.asc`);
  if (evs === null) return { ok: false, error: 'flag_read_failed — refusing to re-flag blind' };
  const vendorProductByJob = new Map();
  // ⚠️ `seen` / `done` are order-INSENSITIVE, which was fine while a job could only ever go
  // flag → resolved. A vague finding can now be withdrawn and replaced by a precise one in the
  // same run, so a job legitimately carries RESOLVED *and* a newer FLAG — and a set-only read
  // calls that "settled" and re-flags it every run forever. liveKind answers the question the
  // sets cannot: is a flag standing RIGHT NOW, and which one. (evs is ordered created_at.asc,
  // so the last write per job wins.)
  const liveKind = new Map();
  for (const e of evs) {
    const id = e && e.payload && e.payload.job_id; if (!id) continue;
    if (e.type === VENDOR) { if (e.payload.product) vendorProductByJob.set(String(id), String(e.payload.product)); continue; }
    seen.add(String(id));
    if (e.type === FLAG) liveKind.set(String(id), String(e.payload.kind || 'flag'));
    if (e.type === RESOLVED) { done.add(String(id)); liveKind.delete(String(id)); }
  }

  const res = {
    ok: true, mode: apply ? 'live' : 'dryrun', days: days || 'all',
    jobs_scanned: jobs.length, unscheduled_included: jobs.filter((j) => !j.scheduled_day).length, already_flagged: 0,
    added_machines_checked: 0, added_in_stop_scanned: 0,
    flagged: 0, second_machine: 0, label_mismatch: 0, added_machine_label: 0, one_machine: 0,
    refused: { combo: 0, reference: 0 },
    retired: 0, retired_jobs: [],
    candidates: [], errors: 0,
  };

  res.added_in_stop_scanned = addedInStop.length;
  const scan = jobs.map((j) => ({ j, narrow: false })).concat(addedInStop.map((j) => ({ j, narrow: true })));

  for (const { j, narrow } of scan) {
    const label = (j.unit && j.unit.label) || '';
    const attrs = (j.unit && j.unit.attributes) || {};
    const d = detect(label, j.problem, { model: attrs.model, vendorProduct: vendorProductByJob.get(String(j.id)) });

    // ── Is this machine labelled as ITSELF? ─────────────────────────────────────
    // A machine the tech added at the door carries the appliance HE picked in its own problem
    // text. When the ticket's label has since drifted off that, this is not the vague "is it
    // on the right machine?" — we know exactly which two answers are in play and can hand the
    // model over as the tiebreaker. Naming the conflict turns a five-minute investigation into
    // a ten-second decision. It does NOT pick the winner: on 21590 the declared machine and
    // the model genuinely disagree, and guessing there is how a tech gets sent out blind.
    const declared = addedAtStop(j.problem);
    const labelled = (d.appliances.indexOf(d.primary) >= 0 ? d.primary : null);
    if (declared) res.added_machines_checked++;
    if (declared && labelled && declared !== labelled) {
      const live = liveKind.get(String(j.id)) || null;
      const standing = !!live;
      // Already saying the precise thing — leave it alone rather than churn the queue.
      if (live === 'added_machine_label') { res.already_flagged++; continue; }
      // Asked once and settled (by a human or by a withdrawal). Do not resurrect it.
      if (!live && seen.has(String(j.id))) { res.already_flagged++; continue; }
      const byModel = modelAppliance(attrs.model);
      const agrees = byModel ? (byModel === declared ? 'declared' : (byModel === labelled ? 'label' : 'neither')) : '';
      const row = {
        job_id: j.id, kind: 'added_machine_label',
        declared, labelled, model_says: byModel || null, model_agrees_with: agrees || null,
        primary: labelled, extra: [declared], appliances: d.appliances,
        claim: j.claim_number || null, day: j.scheduled_day || null, source: j.source || null,
        in_stop: !!j.stop_id, label, model: attrs.model || null,
        text: d.text.slice(0, 400),
        ask: 'the tech added this as a ' + declared + ' at the door, but the ticket is labelled "'
          + (label || '(no label)') + '"'
          + (byModel ? (' — and the model ' + attrs.model + ' is a ' + byModel + ', which agrees with the '
              + (agrees === 'neither' ? 'neither side' : agrees)) : '')
          + '. Which machine is it?',
      };
      row.replaces = live;
      res.added_machine_label++;
      if (res.candidates.length < 40) res.candidates.push(row);
      if (!apply) { res.flagged++; if (standing) res.retired++; continue; }
      // A vague flag and a precise one on the same machine are the same question asked twice.
      // Withdraw the vague one first so the queue never shows both.
      if (standing) {
        try {
          const rq = await fetch(`${base}/rest/v1/event`, {
            method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
            body: JSON.stringify({ company_id: TN_COMPANY, type: RESOLVED, entity: 'job',
              payload: { job_id: j.id, how: 'auto_withdrawn', why: 'replaced by a precise added-machine finding', label, by: 'platform-intake-split-watch' } }),
            signal: AbortSignal.timeout(12000),
          });
          if (rq.ok) res.retired++; else res.errors++;
        } catch (_) { res.errors++; }
      }
      try {
        const r = await fetch(`${base}/rest/v1/event`, {
          method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
          body: JSON.stringify({ company_id: TN_COMPANY, type: FLAG, entity: 'job', payload: row }),
          signal: AbortSignal.timeout(12000),
        });
        if (r.ok) res.flagged++; else res.errors++;
      } catch (_) { res.errors++; }
      continue;
    }
    // the narrow pass exists ONLY to answer the question above — it must never claim a second
    // machine on a stop whose machines are already sorted.
    if (narrow) continue;

    if (!d.multi) {
      if (/combo/.test(d.why)) res.refused.combo++;
      else if (/another job/.test(d.why)) res.refused.reference++;
      else res.one_machine++;
      // A flag we can no longer stand behind must come DOWN. Leaving it up asks a tech to
      // answer a question the system already knows the answer to, and the next honest flag
      // gets less attention for it. Retire it the same way a human would — a resolved row,
      // never an edit to the job — and say plainly that the machine evidence settled it.
      if (seen.has(String(j.id)) && !done.has(String(j.id)) && d.why && d.why !== 'one machine') {
        res.retired_jobs.push({ job_id: j.id, why: d.why, label });
        if (!apply) { res.retired++; continue; }
        try {
          const rr = await fetch(`${base}/rest/v1/event`, {
            method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
            body: JSON.stringify({ company_id: TN_COMPANY, type: RESOLVED, entity: 'job',
              payload: { job_id: j.id, how: 'auto_withdrawn', why: d.why, label, by: 'platform-intake-split-watch' } }),
            signal: AbortSignal.timeout(12000),
          });
          if (rr.ok) res.retired++; else res.errors++;
        } catch (_) { res.errors++; }
      }
      continue;
    }
    if (seen.has(String(j.id))) { res.already_flagged++; continue; }

    const row = {
      job_id: j.id, kind: d.kind, primary: d.primary, extra: d.extra, appliances: d.appliances,
      claim: j.claim_number || null, day: j.scheduled_day || null, source: j.source || null,
      label, model: attrs.model || null, vendor_product: vendorProductByJob.get(String(j.id)) || null,
      text: d.text.slice(0, 400),
      // what a human should actually be asked — the two cases are not the same question
      ask: d.kind === 'label_mismatch'
        ? ('this ticket says ' + (d.primary || '?') + ', but the dispatch describes the ' + (d.in_problem || []).join(' + ') + ' — is it on the right machine?')
        : ('the dispatch also names a ' + (d.extra || []).join(' + ') + ' — add it to this stop?'),
    };
    if (d.kind === 'label_mismatch') res.label_mismatch++; else res.second_machine++;
    if (res.candidates.length < 40) res.candidates.push(row);
    if (!apply) { res.flagged++; continue; }

    try {
      const r = await fetch(`${base}/rest/v1/event`, {
        method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
        body: JSON.stringify({ company_id: TN_COMPANY, type: FLAG, entity: 'job', payload: row }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) res.flagged++; else res.errors++;
    } catch (_) { res.errors++; }
  }

  return res;
}

// ?probe=<job_id> replays the EXACT PostgREST filter platform/tech-job.html builds for the
// flag banner. SQL proving the row exists proves nothing about whether the page can fetch it
// — a JSON-path filter is its own failure mode, and an empty result there looks identical to
// "no flag" from the outside. Read-only.
async function probeFlag(jobId) {
  const base = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const path = `event?select=id,type,payload&type=in.(${FLAG},${RESOLVED})`
    + `&payload->>job_id=eq.${encodeURIComponent(jobId)}&order=created_at.desc&limit=6`;
  const r = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(12000),
  });
  const body = await r.text();
  let rows = null; try { rows = JSON.parse(body); } catch (_) {}
  return { ok: r.ok, status: r.status, url_filter: 'payload->>job_id=eq.' + jobId,
    rows: Array.isArray(rows) ? rows.length : null,
    kinds: Array.isArray(rows) ? rows.map((x) => x.type + ':' + ((x.payload || {}).kind || '')) : null,
    raw: Array.isArray(rows) ? undefined : body.slice(0, 300) };
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden — ?secret=' });
  if (q.probe) return json(200, await probeFlag(q.probe));
  const res = await runIntakeSplit({ apply: q.apply === '1', days: q.days });
  return json(200, res);
};
exports.runIntakeSplit = runIntakeSplit;
