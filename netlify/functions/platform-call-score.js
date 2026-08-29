// platform-call-score — the per-tenant phone-AI ACCURACY AUDIT (Phase 5, the daily flywheel).
//
// Runs the shop's ACTIVE jobs through the REAL call brain (the exact phrasing Ann speaks) and
// grades each answer against the board's own record — the platform port of TN's phone-accuracy
// -audit, per tenant. It proves the grounding holds on real data:
//   - NO invented clock time (day-only, always)
//   - a scheduled job's answer NAMES the right day
//   - names the tech, or says "your technician" when there is none
// and surfaces DATA gaps (scheduled-but-no-day jobs Ann has to hedge) the shop can fix.
//
// Stores a call_score row per run so a TREND accrues (better every day). The owner card reads
// call_score directly via RLS; this endpoint runs the audit (cron + on-demand).
//
//   POST ?do=audit &slug=<board> &secret=<admin>   (or Bearer session -> owner's company)
//     -> { ok, shop, sampled, correct, pct, no_time_ok, day_ok, tech_ok, gaps, mismatches[] }
//
// NOTE: a transcript-based LLM call grader (grading real call recordings) is a future add —
// it needs live platform call volume + Telnyx recordings, which aren't wired yet. This audit
// needs neither: it grades whether Ann WOULD answer correctly for every active job right now.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { compose, dayLabel } = require('./platform-call-brain');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Content-Type': 'application/json' };
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
const AWAIT = { awaiting_parts: 1, ordered: 1, on_order: 1, pending: 1, to_order: 1 };
const TERMINAL = { completed: 1, canceled: 1 };

async function base() { return ((await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co').replace(/\/+$/, ''); }
async function svcKey() { return (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || ''; }

// admin secret + slug|company, OR session Bearer -> the caller's company
async function resolveCompany(event, q) {
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const b = await base(); const key = await svcKey();
  const H = { apikey: key, Authorization: 'Bearer ' + key };
  if (q.secret && q.secret === admin) {
    if (q.company) return { companyId: String(q.company) };
    if (q.slug) {
      const r = await fetch(`${b}/rest/v1/company?slug=eq.${encodeURIComponent(String(q.slug).toLowerCase())}&select=id&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
      const c = ((await r.json().catch(() => []))[0]); return c ? { companyId: c.id } : null;
    }
    return null;
  }
  const m = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '').match(/Bearer\s+(.+)/i);
  if (!m) return null;
  try {
    const ur = await fetch(`${b}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!ur.ok) return null;
    const u = await ur.json().catch(() => null); if (!u || !u.id) return null;
    const ar = await fetch(`${b}/rest/v1/app_user?auth_user_id=eq.${u.id}&select=company_id&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    const a = ((await ar.json().catch(() => []))[0]); return a ? { companyId: a.company_id } : null;
  } catch (_) { return null; }
}

// audit ONE company: pull active jobs, grade the brain's answer for each.
async function audit(companyId, limit) {
  const b = await base(); const key = await svcKey();
  const H = { apikey: key, Authorization: 'Bearer ' + key };
  const cr = await fetch(`${b}/rest/v1/company?id=eq.${companyId}&select=name&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
  const shop = (((await cr.json().catch(() => []))[0]) || {}).name || 'shop';
  const sel = 'id,status,scheduled_day,started_at,parts_status,parts_eta,warranty_company,claim_number,customer:customer_id(first_name),technician:technician_id(name),unit:unit_id(label)';
  const jr = await fetch(`${b}/rest/v1/job?company_id=eq.${companyId}&status=not.in.(completed,canceled)&select=${encodeURIComponent(sel)}&order=created_at.desc&limit=${limit}`, { headers: H, signal: AbortSignal.timeout(9000) });
  const jobs = jr.ok ? (await jr.json().catch(() => [])) : [];

  let sampled = 0, correct = 0, noTimeOk = 0, dayOk = 0, techOk = 0, gaps = 0;
  const mismatches = [], gapJobs = [];
  for (const j of jobs) {
    const techFirst = j.technician && j.technician.name ? String(j.technician.name).split(/\s+/)[0] : '';
    const facts = {
      found: true,
      customer: { first_name: (j.customer && j.customer.first_name) || '' },
      job: {
        id: j.id, status: j.status, scheduled_day: j.scheduled_day, started_at: j.started_at,
        parts_status: j.parts_status, parts_eta: j.parts_eta, warranty_company: j.warranty_company,
        claim_number: j.claim_number, tech_first: techFirst, unit_label: (j.unit && j.unit.label) || '',
      },
    };
    const ans = compose(shop, facts).customer || '';
    sampled++;
    const st = String(j.status || ''); const day = j.scheduled_day;
    const partsy = AWAIT[st] || AWAIT[String(j.parts_status || '')];
    const startedy = !!j.started_at && !TERMINAL[st];
    const scheduledBranch = !!day && !TERMINAL[st] && !partsy && !startedy;

    const hasTime = /\b\d{1,2}:\d{2}\b/.test(ans) || /\b\d{1,2}\s?[ap]\.?m\.?\b/i.test(ans);
    const no_time = !hasTime;
    const day_good = scheduledBranch ? ans.includes(dayLabel(day)) : true;
    const tech_good = (scheduledBranch && !techFirst) ? /your technician/i.test(ans) : true;
    const gap = (st === 'scheduled' && !day);

    if (no_time) noTimeOk++;
    if (day_good) dayOk++;
    if (tech_good) techOk++;
    if (gap) { gaps++; if (gapJobs.length < 8) gapJobs.push(j.id); }
    const good = no_time && day_good && tech_good;
    if (good) correct++;
    else if (mismatches.length < 8) mismatches.push({ job_id: j.id, status: st, day: day || null, why: [!no_time && 'invented_time', !day_good && 'missing_day', !tech_good && 'no_tech_hedge'].filter(Boolean), answer: ans.slice(0, 140) });
  }
  const pct = sampled ? Math.round((correct / sampled) * 100) : 100;
  return { shop, sampled, correct, pct, no_time_ok: noTimeOk, day_ok: dayOk, tech_ok: techOk, gaps, mismatches, gap_jobs: gapJobs };
}

async function store(companyId, r) {
  const b = await base(); const key = await svcKey();
  try {
    await fetch(`${b}/rest/v1/call_score`, {
      method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: companyId, sampled: r.sampled, correct: r.correct, pct: r.pct, no_time_ok: r.no_time_ok, day_ok: r.day_ok, tech_ok: r.tech_ok, gaps: r.gaps, detail: { mismatches: r.mismatches, gap_jobs: r.gap_jobs } }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  const doo = String(q.do || 'audit');
  const who = await resolveCompany(event, q);
  if (!who) return json(401, { ok: false, error: 'not_authorized' });

  if (doo === 'audit') {
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 30, 1), 60);
    let r; try { r = await audit(who.companyId, limit); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 140) }); }
    if (q.store !== '0') await store(who.companyId, r);
    return json(200, { ok: true, ...r });
  }
  return json(400, { ok: false, error: 'unknown do: ' + doo });
};

// reused by the daily cron
exports.audit = audit;
exports.store = store;
