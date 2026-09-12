// platform-stop-link — link the machines of ONE stop so the multi-machine surfaces that are
// already built actually light up.
//
// WHY THIS EXISTS. Measured 2026-09-12 on the platform:
//
//     jobs with stop_id .......... 0 of 3,726
//     real multi-machine stops ... 51  (110 jobs, biggest 3 machines)
//
// The whole multi-machine spine was shipped and applied months ago and has never once been
// used. Migration 020 added job.stop_id (live, verified). platform/tech-job.html renders the
// "🧩 This stop — machines" chip row and ＋ Add machine. platform/office-board.html renders a
// "🧩 N machines" flag. Each machine is already its own job -> its own unit -> its own TDR,
// which is exactly the "one report per machine" shape (verified: a 3-machine stop carries 3
// job_tdr rows). Every one of those reads is keyed on stop_id — and NOTHING sets stop_id.
//
// So the office sees a 3-appliance visit as 3 unrelated tiles, the tech sees 3 unrelated
// tickets, and the ＋ Add machine path only helps a stop a tech thinks to link by hand.
//
// ⚠️ THIS LINKS. IT NEVER CREATES. The Xano-side multi-machine-watch INVENTS a sibling job
// from problem text; this does the opposite and only ties together jobs that already exist.
// A wrong create puts a machine on a ticket nobody is servicing; a wrong link costs one tap.
//
// THE KEY, chosen off the real data rather than assumed. Of the 51 unlinked stops:
//
//     same claim ........ 34 stops / 74 jobs   <- unambiguous, auto-linked
//     different claims ... 10 stops / 22 jobs   <- SquareTrade issues a WO per machine, but
//     mixed .............. 4 stops /  8 jobs      a same-day repeat is ALSO how a duplicate
//     no claim at all .... 3 stops /  6 jobs      looks. Reported, never guessed.
//
// And inside the same-claim set, 7 of 35 groups REPEAT a machine (same unit_id, or a blank
// one) — those are a duplicate or a return trip on ONE machine, not two machines. So the
// auto rule also requires every job in the group to carry a real, DISTINCT appliance label.
// That test is what separates "a washer and a dryer" from "this washer, twice".
//
// WRITES EXACTLY ONE COLUMN: job.stop_id. Never status, never the TDR, never parts, never a
// customer row. Reversal is `?unlink=1&confirm=yes`, which clears stop_id on groups that
// contain no tech-added machine — so it can never undo a tech's own ＋ Add machine.
//
//   GET ?secret=<admin>            shadow — what it WOULD link + what it refuses to guess
//   GET ?secret=<admin>&apply=1    link for real
//   GET ?secret=<admin>&unlink=1&confirm=yes   put it back
//   GET ?secret=<admin>&days=N     how far back to look (default 180; 0 = all)
//   Kill switch: vault PLATFORM_STOP_LINK_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { segToAppliance } = require('./_lib/appliance-vocab');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const MAX_MACHINES = 6;          // a stop bigger than this is a data problem, not a visit
const TECH_ADDED = 'tech_add_machine';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// A machine's identity is its APPLIANCE TYPE, not its label text. "Samsung washer" and
// "washer" are one machine described two ways — comparing the raw labels would read them as
// two and link a duplicate as a second appliance. Uses the shared vocabulary (which already
// carries the dishwasher-before-washer ordering) so this can never drift from the splitter.
// Returns '' when the label names no appliance we recognise — a row that does not say what
// it is has to be looked at by a human, not guessed at.
function machineKey(label) { return segToAppliance(label) || ''; }
function claimKey(c) { return String(c || '').trim(); }

async function runStopLink(opts) {
  const o = opts || {};
  const apply = !!o.apply;
  const unlink = !!o.unlink;
  const days = o.days === 0 ? 0 : (parseInt(o.days, 10) || 180);

  const enabled = String((await getSecretFresh('PLATFORM_STOP_LINK_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (apply && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_STOP_LINK_ENABLED=false' };

  const base = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const SB = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  // ── read the candidate jobs, PAGED. The 1,000-row cap is silent, and a short read here
  // would quietly drop half a stop and link the rest — worse than not running at all.
  const since = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '';
  const sel = 'id,customer_id,scheduled_day,claim_number,status,source,stop_id,created_at,unit:unit_id(id,label)';
  let filter = `company_id=eq.${TN_COMPANY}&scheduled_day=not.is.null&status=neq.canceled&select=${encodeURIComponent(sel)}&order=id.asc`;
  if (since) filter += `&scheduled_day=gte.${since}`;

  const jobs = [];
  let truncated = false;
  for (let from = 0; from < 20000; from += 1000) {
    let rows = [];
    try {
      const r = await fetch(`${base}/rest/v1/job?${filter}`, {
        headers: Object.assign({ Range: `${from}-${from + 999}` }, SB), signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) { truncated = true; break; }
      rows = await r.json().catch(() => []);
    } catch (_) { truncated = true; break; }
    if (!Array.isArray(rows) || !rows.length) break;
    jobs.push(...rows);
    if (rows.length < 1000) break;
    if (from + 1000 >= 20000) truncated = true;
  }
  if (truncated) return { ok: false, error: 'platform_read_incomplete — refusing to link off a short read' };

  // ── group by the stop: one customer, one day ──
  const groups = new Map();
  for (const j of jobs) {
    if (!j.customer_id || !j.scheduled_day) continue;
    const k = j.customer_id + '|' + j.scheduled_day;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }

  const res = {
    ok: true,
    mode: unlink ? (apply ? 'unlink' : 'unlink_dryrun') : (apply ? 'live' : 'dryrun'),
    days: days || 'all',
    jobs_scanned: jobs.length,
    stops_seen: 0,
    linked: 0, jobs_linked: 0, already_linked: 0, unlinked: 0,
    refused: { different_claims: 0, no_claim: 0, same_machine_twice: 0, blank_machine: 0, too_many: 0 },
    needs_a_human: [],
    samples: [],
    errors: 0,
  };

  for (const [, list] of groups) {
    if (list.length < 2) continue;
    res.stops_seen++;

    const anyTechAdded = list.some((j) => String(j.source || '') === TECH_ADDED);
    const already = list.filter((j) => j.stop_id);

    // ── reversal: clear only what this tool could have set ──
    if (unlink) {
      if (!already.length || anyTechAdded) continue;
      if (!apply) { res.unlinked += already.length; continue; }
      for (const j of already) {
        try {
          const r = await fetch(`${base}/rest/v1/job?id=eq.${j.id}&company_id=eq.${TN_COMPANY}`, {
            method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
            body: JSON.stringify({ stop_id: null }), signal: AbortSignal.timeout(12000),
          });
          if (r.ok) res.unlinked++; else res.errors++;
        } catch (_) { res.errors++; }
      }
      continue;
    }

    if (already.length) { res.already_linked++; continue; }   // a tech already anchored this stop

    const cust = list[0].customer_id;
    const day = list[0].scheduled_day;
    const label = (j) => (j.unit && j.unit.label) || '';
    const note = (why) => {
      if (res.needs_a_human.length < 25) {
        res.needs_a_human.push({
          why, customer_id: cust, day, n: list.length,
          machines: list.map(label).map((s) => s || '(no machine named)'),
          claims: Array.from(new Set(list.map((j) => claimKey(j.claim_number) || '(none)'))),
          job_ids: list.map((j) => j.id),
        });
      }
    };

    if (list.length > MAX_MACHINES) { res.refused.too_many++; note('more machines than a real visit — looks like a data problem'); continue; }

    // one claim, and a real one. A claim covering several appliances IS the multi-item dispatch.
    const claims = Array.from(new Set(list.map((j) => claimKey(j.claim_number))));
    if (claims.length === 1 && claims[0] === '') { res.refused.no_claim++; note('no claim on any of them — could be one visit or two bookings'); continue; }
    if (claims.length > 1) { res.refused.different_claims++; note('different claim per job — a machine each, or a duplicate; a human decides'); continue; }

    // every job names a machine, and they are DIFFERENT machines.
    const keys = list.map((j) => machineKey(label(j)));
    if (keys.some((k) => !k)) { res.refused.blank_machine++; note('a job here does not name a machine we recognise'); continue; }
    if (new Set(keys).size !== keys.length) { res.refused.same_machine_twice++; note('the same appliance twice — a duplicate or a return trip, not two machines'); continue; }

    // anchor = the job the stop started as
    const sorted = list.slice().sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
    const anchor = sorted[0].id;

    if (res.samples.length < 12) {
      res.samples.push({ day, claim: claims[0], anchor, machines: sorted.map(label), types: sorted.map((j) => machineKey(label(j))), job_ids: sorted.map((j) => j.id) });
    }
    if (!apply) { res.linked++; res.jobs_linked += sorted.length; continue; }

    let wrote = 0;
    for (const j of sorted) {
      try {
        const r = await fetch(`${base}/rest/v1/job?id=eq.${j.id}&company_id=eq.${TN_COMPANY}`, {
          method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
          body: JSON.stringify({ stop_id: anchor }), signal: AbortSignal.timeout(12000),
        });
        if (r.ok) wrote++; else res.errors++;
      } catch (_) { res.errors++; }
    }
    if (wrote) { res.linked++; res.jobs_linked += wrote; }
  }

  // audit lands on the PLATFORM, not Xano — this is a platform-native tool and a record of
  // what it touched must not depend on the system we are migrating off.
  if (apply && (res.jobs_linked || res.unlinked || res.errors)) {
    try {
      await fetch(`${base}/rest/v1/event`, {
        method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
        body: JSON.stringify({
          company_id: TN_COMPANY, type: unlink ? 'stop_link_unlinked' : 'stop_link_run', entity: 'job',
          payload: { linked: res.linked, jobs_linked: res.jobs_linked, unlinked: res.unlinked, refused: res.refused, errors: res.errors },
        }),
        signal: AbortSignal.timeout(12000),
      });
    } catch (_) {}
  }

  return res;
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden — ?secret=' });
  const unlink = q.unlink === '1';
  const apply = unlink ? (q.confirm === 'yes') : (q.apply === '1');
  const res = await runStopLink({ apply, unlink, days: q.days });
  return json(200, res);
};
exports.runStopLink = runStopLink;
exports.machineKey = machineKey;
