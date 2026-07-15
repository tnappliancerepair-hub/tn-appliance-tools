// squaretrade-redispatch-link — warranty duplicate combiner.
//
// The problem (Teddy 2026-07-15): SquareTrade / ServicePower / AHS send MULTIPLE emails
// carrying the SAME job, which spawns MULTIPLE tickets. We need one ticket. And sometimes
// they send a ticket for the SAME customer but a DIFFERENT machine (a real second job) --
// that must stay separate.
//
// The rule:
//   * SAME customer (phone) + SAME appliance  = a DUPLICATE -> combine into the ONE that
//     is furthest along (real report + photos + lifecycle), carry EVERY WO/claim number
//     onto it (so office search finds the job by any of them), soft-cancel the empties.
//   * SAME customer + DIFFERENT appliance      = an ADDITIONAL MACHINE -> left alone.
//   * If two twins BOTH hold real work          = flagged for a human, never auto-merged.
//
// Nothing is deleted; the loser is soft-canceled (reversible) with a pointer to the keeper.
// The keeper is chosen by what it HOLDS, so a completed/reported job always wins over a
// fresh blank re-send.
//
//   GET ?secret=<admin>              DRY RUN - show the plan (default, safe)
//   GET ?secret=<admin>&confirm=1    act now
//   scheduled                        shadow-logs unless SQUARETRADE_REDISPATCH_LINK=true
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const p10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const ms = (x) => x ? new Date(x).getTime() : 0;
const low = (v) => String(v || '').toLowerCase();
const isCanceled = (jb) => /cancel/i.test(low(jb.scheduling_status)) || /cancel/i.test(low(jb.current_status));
const isCompleted = (jb) => /completed/.test(low(jb.scheduling_status)) || /completed/.test(low(jb.current_status));
const isWarranty = (jb) => !!String(jb.warranty_company || '').trim() || /warranty/i.test(low(jb.customer_type));
function normAppl(s) {
  s = low(s);
  if (/fridge|refriger/.test(s)) return 'refrigerator';
  if (/wash/.test(s)) return 'washer';
  if (/\bdry/.test(s)) return 'dryer';
  if (/dish/.test(s)) return 'dishwasher';
  if (/range|stove|oven|cooktop/.test(s)) return 'range';
  if (/microwav/.test(s)) return 'microwave';
  if (/freez/.test(s)) return 'freezer';
  if (/ice/.test(s)) return 'icemaker';
  return s.replace(/[^a-z]/g, '').slice(0, 12);
}
async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}
// "Furthest along": what the job actually HOLDS. Report content + photos dominate (that is
// the thing we must never lose), then lifecycle progress. qc_cockpit_load reads TDR rows +
// attachments reliably. Returned .score decides the keeper.
async function furthestAlong(jb) {
  let atts = 0, tdrContent = 0, tdrs = 0;
  try {
    const d = await (await fetch(`${XANO}/qc_cockpit_load?job_id=${jb.id}`, { signal: AbortSignal.timeout(12000) })).json();
    atts = (d.attachments || []).length;
    const rows = (d.all_tdrs || []);
    tdrs = rows.length;
    tdrContent = rows.filter((t) => String(t.diagnosis || '').trim() || String(t.failed_component || '').trim() || String(t.repair_completed || '').trim()).length;
  } catch (_) {}
  let life = 0;
  if (isCompleted(jb)) life += 20;
  if (low(jb.scheduling_status) === 'in_progress' || low(jb.current_status) === 'in_progress') life += 8;
  if (String(jb.parts_status || '').trim() || String(jb.parts_eta_date || '').trim()) life += 6;
  if (Number(jb.scheduled_start || 0) > 0) life += 2;
  if (Number(jb.technician_id || 0) > 0) life += 1;
  const workScore = atts * 10 + tdrContent * 5;   // the report/photos we protect
  return { atts, tdrContent, tdrs, work: workScore, score: workScore + life };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const envLive = (await getSecret('SQUARETRADE_REDISPATCH_LINK')) === 'true';
  const isCron = !q.secret;
  if (!isCron && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const live = q.dry === '1' ? false : (envLive || (q.secret === admin && q.confirm === '1'));
  // Only combine when a FRESH duplicate (last N days) is involved -- never disturb old,
  // settled history.
  const freshDays = Math.max(1, Math.min(45, parseInt(q.fresh_days, 10) || 14));
  const freshCut = Date.now() - freshDays * 86400000;

  let jobs = [];
  try { for (let pg = 1; pg <= 5; pg++) { const rows = await listPage(7, 400, pg); jobs = jobs.concat(rows); if (rows.length < 400) break; } }
  catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // Group live (non-canceled) warranty jobs by customer phone + APPLIANCE. Same appliance
  // = same machine = duplicate candidates. Different appliance never groups together, so a
  // second machine for the same customer is safe. Blank appliance is NOT grouped (we won't
  // merge machines we cannot confirm are the same).
  const groups = {};
  for (const jb of jobs) {
    if (isCanceled(jb) || !isWarranty(jb)) continue;
    const ph = p10(jb.customer_phone);
    if (ph.length !== 10) continue;
    const appl = normAppl(jb.appliance_type || jb.appliance);
    if (!appl) continue;
    (groups[ph + '|' + appl] = groups[ph + '|' + appl] || []).push(jb);
  }

  const plan = [];
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.length < 2) continue;
    if (!g.some((x) => ms(x.created_at) >= freshCut)) continue;   // a fresh duplicate must be involved
    // Score every candidate by what it holds; keeper = furthest along, tiebreak oldest.
    const scored = [];
    for (const jb of g) scored.push({ jb, w: await furthestAlong(jb) });
    scored.sort((a, b) => (b.w.score - a.w.score) || (ms(a.jb.created_at) - ms(b.jb.created_at)));
    const keeper = scored[0];
    // Every distinct WO/claim number in the group, minus what the keeper already carries.
    const allClaims = [...new Set(g.map((x) => String(x.claim_number || '').trim()).filter(Boolean))];
    const keeperClaim = String(keeper.jb.claim_number || '').trim();
    const extraWos = allClaims.filter((c) => c !== keeperClaim);
    for (let i = 1; i < scored.length; i++) {
      const loser = scored[i];
      if (isCompleted(loser.jb)) { continue; }   // never cancel a completed job; keeper already outranks it
      const bothWork = keeper.w.work > 0 && loser.w.work > 0;
      plan.push({
        keeper_job: keeper.jb.id, keeper_holds: { photos: keeper.w.atts, reports: keeper.w.tdrContent, score: keeper.w.score },
        cancel_dupe: loser.jb.id, dupe_holds: { photos: loser.w.atts, reports: loser.w.tdrContent },
        customer: ((keeper.jb.customer_first || '') + ' ' + (keeper.jb.customer_last || '')).trim(),
        appliance: key.split('|')[1],
        carry_wos: extraWos,
        action: bothWork ? 'REVIEW_both_hold_work' : 'COMBINE',
      });
    }
  }

  const out = { ok: true, mode: live ? 'LIVE' : (isCron ? 'shadow' : 'DRY'), fresh_days: freshDays, combines: plan.length, plan };
  if (!live) { out.note = isCron ? 'shadow - set SQUARETRADE_REDISPATCH_LINK=true to act' : 'DRY RUN - add &confirm=1 to act'; return j(200, out); }

  // Act on the clean COMBINE cases. Carry the extra WO numbers onto the keeper's empty
  // searchable fields (office search already matches claim_number, dispatch_source_id,
  // job_number, housecall_pro_job_id), then soft-cancel the duplicate.
  const SLOTS = ['dispatch_source_id', 'job_number', 'housecall_pro_job_id'];
  let combined = 0; const fails = [];
  const byId = {}; jobs.forEach((x) => { byId[x.id] = x; });
  for (const p of plan) {
    if (p.action !== 'COMBINE') continue;
    try {
      const keeper = byId[p.keeper_job] || {};
      const patch = {}; const noteWos = [];
      let slotI = 0;
      for (const wo of p.carry_wos) {
        // already present anywhere searchable? skip.
        const present = SLOTS.concat(['claim_number']).some((f) => String(keeper[f] || patch[f] || '').includes(wo));
        if (present) continue;
        let placed = false;
        while (slotI < SLOTS.length) {
          const f = SLOTS[slotI];
          if (!String(keeper[f] || '').trim() && !patch[f]) { patch[f] = wo; placed = true; slotI++; break; }
          slotI++;
        }
        if (!placed) noteWos.push(wo);
      }
      if (noteWos.length) patch.notes_internal = String(keeper.notes_internal || '') + `\n[additional WO#: ${noteWos.join(', ')} (combined from dup #${p.cancel_dupe})]`;
      if (Object.keys(patch).length) await fetch(`${META}/table/7/content/${p.keeper_job}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) }).catch(() => {});
      const r = await fetch(`${XANO}/office_set_job_status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: p.cancel_dupe, scheduling_status: 'canceled', actor: 'warranty_dupe_combine' }) });
      if (r.ok) {
        combined++;
        // Move the WO fully to the keeper: strip it off the canceled dup so a search for
        // that number returns the ACTIVE keeper, not the dead twin. (Teddy 2026-07-15)
        await fetch(`${META}/table/7/content/${p.cancel_dupe}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ claim_number: '', dispatch_source_id: '' }) }).catch(() => {});
        await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'warranty_dupe_combined', metadata: { keeper_job: p.keeper_job, canceled_dupe: p.cancel_dupe, carried_wos: p.carry_wos, appliance: p.appliance, at_ms: Date.now() } }) }).catch(() => {});
      } else fails.push({ dupe: p.cancel_dupe, status: r.status });
    } catch (e) { fails.push({ dupe: p.cancel_dupe, err: String(e.message || e) }); }
  }
  // HEAL: any CANCELED job still carrying a WO that now lives on a different ACTIVE job
  // (e.g. the 4 combined before this clear-on-cancel shipped) gets its WO stripped so it
  // can never shadow the active keeper in search.
  const activeWos = new Set();
  for (const jb of jobs) { if (isCanceled(jb)) continue; [jb.claim_number, jb.dispatch_source_id, jb.job_number].forEach((w) => { const t = String(w || '').trim(); if (t) activeWos.add(t); }); }
  let healed = 0;
  for (const jb of jobs) {
    if (!isCanceled(jb)) continue;
    const c = String(jb.claim_number || '').trim();
    if (c && activeWos.has(c)) {
      try { await fetch(`${META}/table/7/content/${jb.id}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ claim_number: '', dispatch_source_id: '' }) }); healed++; } catch (_) {}
    }
  }
  out.combined = combined; out.healed = healed; out.failed = fails.length; out.failed_list = fails.slice(0, 8);
  return j(200, out);
};
