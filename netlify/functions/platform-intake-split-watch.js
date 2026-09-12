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
//   GET ?secret=<admin>            shadow — what it WOULD flag
//   GET ?secret=<admin>&apply=1    write the flags
//   GET ?secret=<admin>&days=N     window (default 45; 0 = all)
//   Kill switch: vault PLATFORM_INTAKE_SPLIT_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { detect } = require('./_lib/multi-appliance');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const FLAG = 'multi_appliance_suspected';
const RESOLVED = 'multi_appliance_resolved';

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

  const sel = 'id,problem,status,source,claim_number,scheduled_day,created_at,unit:unit_id(label)';
  let f = `job?company_id=eq.${TN_COMPANY}&stop_id=is.null&status=neq.canceled&select=${encodeURIComponent(sel)}&order=id.asc`;
  if (days) f += `&created_at=gte.${new Date(Date.now() - days * 86400000).toISOString()}`;
  const jobs = await page(f);
  if (!jobs) return { ok: false, error: 'platform_read_incomplete — refusing to flag off a short read' };

  // already flagged / already dealt with — never offer the same machine twice
  const seen = new Set();
  const evs = await page(`event?company_id=eq.${TN_COMPANY}&type=in.(${FLAG},${RESOLVED})&select=payload&order=id.asc`);
  if (evs === null) return { ok: false, error: 'flag_read_failed — refusing to re-flag blind' };
  for (const e of evs) { const id = e && e.payload && e.payload.job_id; if (id) seen.add(String(id)); }

  const res = {
    ok: true, mode: apply ? 'live' : 'dryrun', days: days || 'all',
    jobs_scanned: jobs.length, already_flagged: 0,
    flagged: 0, second_machine: 0, label_mismatch: 0, one_machine: 0,
    refused: { combo: 0, reference: 0 },
    candidates: [], errors: 0,
  };

  for (const j of jobs) {
    const label = (j.unit && j.unit.label) || '';
    const d = detect(label, j.problem);
    if (!d.multi) {
      if (/combo/.test(d.why)) res.refused.combo++;
      else if (/another job/.test(d.why)) res.refused.reference++;
      else res.one_machine++;
      continue;
    }
    if (seen.has(String(j.id))) { res.already_flagged++; continue; }

    const row = {
      job_id: j.id, kind: d.kind, primary: d.primary, extra: d.extra, appliances: d.appliances,
      claim: j.claim_number || null, day: j.scheduled_day || null, source: j.source || null,
      label, text: d.text.slice(0, 400),
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

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden — ?secret=' });
  const res = await runIntakeSplit({ apply: q.apply === '1', days: q.days });
  return json(200, res);
};
exports.runIntakeSplit = runIntakeSplit;
