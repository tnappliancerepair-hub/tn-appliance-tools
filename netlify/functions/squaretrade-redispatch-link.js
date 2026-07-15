// squaretrade-redispatch-link — fixes the "secondary SquareTrade email erased the
// report/photos" confusion (Danielle 2026-07-15). SquareTrade re-dispatches the SAME
// repair under a NEW claim/WO number, so our claim-number dedup misses it and spawns a
// separate BLANK job. The report + photos are never actually lost (they stay on the
// original job_id), but the office ends up looking at the blank twin.
//
// This LINKS the re-dispatch instead: it finds a fresh SquareTrade job that duplicates an
// existing active job (same customer PHONE + same appliance, DIFFERENT claim), keeps the
// one that actually holds the work (report/photos/parts) as the SURVIVOR, carries the new
// WO number onto it (into dispatch_source_id — which office search already matches, so
// EITHER WO finds the one job), and soft-cancels the blank twin with a pointer to the
// survivor. Nothing is deleted; the cancel is reversible.
//
//   GET ?secret=<admin>              DRY RUN — show the plan (default, safe)
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
const TERMINAL = new Set(['canceled', 'cancelled', 'completed', 'no_fix_possible']);
const isTerminal = (jb) => TERMINAL.has(String(jb.scheduling_status || '').toLowerCase()) || TERMINAL.has(String(jb.current_status || '').toLowerCase());
const isSquareTrade = (jb) => /square\s*trade/i.test(String(jb.warranty_company || ''));
function normAppl(s) {
  s = String(s || '').toLowerCase();
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
// The authoritative "which job holds the work" — real report content + media. qc_cockpit_load
// reads the TDR rows + attachments reliably (unlike get_unified). Never cancel the one with this.
async function workScore(jobId) {
  try {
    const d = await (await fetch(`${XANO}/qc_cockpit_load?job_id=${jobId}`, { signal: AbortSignal.timeout(12000) })).json();
    const atts = (d.attachments || []).length;
    const tdrs = (d.all_tdrs || []);
    const tdrContent = tdrs.filter((t) => String(t.diagnosis || '').trim() || String(t.failed_component || '').trim() || String(t.repair_completed || '').trim()).length;
    return { atts, tdrContent, tdrs: tdrs.length, score: atts * 10 + tdrContent * 5 };
  } catch (_) { return { atts: 0, tdrContent: 0, tdrs: 0, score: 0 }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const envLive = (await getSecret('SQUARETRADE_REDISPATCH_LINK')) === 'true';
  const isCron = !q.secret;
  if (!isCron && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const live = q.dry === '1' ? false : (envLive || (q.secret === admin && q.confirm === '1'));
  // Only pair a FRESH re-dispatch (last N days) with an existing job. Never touch old pairs.
  const freshDays = Math.max(1, Math.min(30, parseInt(q.fresh_days, 10) || 10));
  const freshCut = Date.now() - freshDays * 86400000;

  let jobs = [];
  try { for (let pg = 1; pg <= 4; pg++) { const rows = await listPage(7, 400, pg); jobs = jobs.concat(rows); if (rows.length < 400) break; } }
  catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // Group live SquareTrade jobs by customer phone + appliance.
  const groups = {};
  for (const jb of jobs) {
    if (isTerminal(jb) || !isSquareTrade(jb)) continue;
    const ph = p10(jb.customer_phone);
    if (ph.length !== 10) continue;
    const key = ph + '|' + normAppl(jb.appliance_type || jb.appliance);
    (groups[key] = groups[key] || []).push(jb);
  }

  const plan = [];
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (g.length < 2) continue;
    const claims = new Set(g.map((x) => String(x.claim_number || '').trim()).filter(Boolean));
    if (claims.size < 2) continue;                       // same claim already -> handled by normal dedup
    if (!g.some((x) => ms(x.created_at) >= freshCut)) continue;  // only when a fresh re-dispatch is involved
    // Score each candidate by the work it actually holds (report + photos).
    const scored = [];
    for (const jb of g) scored.push({ jb, w: await workScore(jb.id) });
    scored.sort((a, b) => (b.w.score - a.w.score) || (ms(a.jb.created_at) - ms(b.jb.created_at))); // most work, then oldest
    const survivor = scored[0];
    for (let i = 1; i < scored.length; i++) {
      const loser = scored[i];
      // SAFETY: never cancel a twin that itself carries real work (both have a report =
      // possibly two legit repairs) — flag for a human instead.
      const bothHaveWork = survivor.w.score > 0 && loser.w.score > 0;
      const loserClaim = String(loser.jb.claim_number || '').trim();
      plan.push({
        survivor_job: survivor.jb.id, survivor_work: survivor.w, survivor_claim: String(survivor.jb.claim_number || '').trim(),
        link_wo: loserClaim, cancel_twin: loser.jb.id, twin_work: loser.w,
        customer: ((survivor.jb.customer_first || '') + ' ' + (survivor.jb.customer_last || '')).trim(),
        appliance: normAppl(survivor.jb.appliance_type || survivor.jb.appliance),
        action: bothHaveWork ? 'REVIEW_both_have_work' : 'LINK_and_cancel_blank',
      });
    }
  }

  const out = { ok: true, mode: live ? 'LIVE' : (isCron ? 'shadow' : 'DRY'), fresh_days: freshDays, pairs: plan.length, plan };
  if (!live) { out.note = isCron ? 'shadow — set SQUARETRADE_REDISPATCH_LINK=true to act' : 'DRY RUN — add &confirm=1 to act'; return j(200, out); }

  // Act on the clean cases only.
  let linked = 0; const fails = [];
  for (const p of plan) {
    if (p.action !== 'LINK_and_cancel_blank' || !p.link_wo) continue;
    try {
      // Carry the new WO onto the survivor so EITHER number finds the one job. Use
      // dispatch_source_id when empty (office search already matches it); else append.
      const sv = jobs.find((x) => x.id === p.survivor_job) || {};
      const patch = {};
      if (!String(sv.dispatch_source_id || '').trim()) patch.dispatch_source_id = p.link_wo;
      else if (!String(sv.dispatch_source_id).includes(p.link_wo)) patch.notes_internal = String(sv.notes_internal || '') + `\n[linked WO ${p.link_wo} from re-dispatch job #${p.cancel_twin}]`;
      if (Object.keys(patch).length) await fetch(`${META}/table/7/content/${p.survivor_job}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) }).catch(() => {});
      const r = await fetch(`${XANO}/office_set_job_status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: p.cancel_twin, scheduling_status: 'canceled', actor: 'squaretrade_redispatch_link' }) });
      if (r.ok) {
        linked++;
        await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'squaretrade_redispatch_linked', metadata: { survivor_job: p.survivor_job, canceled_twin: p.cancel_twin, linked_wo: p.link_wo, appliance: p.appliance, at_ms: Date.now() } }) }).catch(() => {});
      } else fails.push({ twin: p.cancel_twin, status: r.status });
    } catch (e) { fails.push({ twin: p.cancel_twin, err: String(e.message || e) }); }
  }
  out.linked = linked; out.failed = fails.length; out.failed_list = fails.slice(0, 8);
  return j(200, out);
};
