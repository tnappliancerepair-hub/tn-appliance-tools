// job-truth — THE single source of truth for a job. One brain, four lenses.
//
// Teddy 2026-07-02: the system got sloppy because every view (office / tech /
// customer / portal / Vapi / warranty lookup) re-derived a job's status its own
// way, so they drifted and every rule had to be patched in N places. This ends
// that: ONE endpoint resolves a job ONCE (canceled→active baked in, part ETA,
// office note, tech, day, money) and composes the exact sentence for each lens.
// Every surface + every agent calls THIS and just renders/speaks the answer.
//
//   GET  /job-truth?job_id=19760           (or ?claim=..., or ?phone=...)
//   GET  /job-truth?claim=59750849&lens=warranty
//   POST /job-truth  { job_id | claim | phone, lens? }
//     -> { ok, found, job_id, facts:{...}, lenses:{ customer, warranty, tech, office } }
//
// lens = customer | warranty | tech | office | all (default all).
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };
const { techCoversState } = require('./_lib/zone-integrity');
const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

// Every hop is bounded. jfetch already degrades to null on error (resolve() and
// buildFacts read defensively), but without a timeout a cold/slow Xano (comments
// elsewhere cite 30s+ cold) could HANG the whole request for any non-phone caller
// (portal, text surfaces, accuracy-audit). The phone path is separately capped at
// 3500ms by vapi-tool's race; this protects everyone else. Fail SAFE → null.
// 6s was too tight for what Xano actually does. Measured 2026-09-10 while the office was
// live: get_job_for_dashboard answered in 4.1s typical and once hung past 40s, so job-truth
// gave up on 2 of every 3 lookups and returned found:false - which reads to a caller as
// "I don't see that one yet," said about a real job scheduled for that same day. A wrong
// answer delivered confidently is worse than a slow one.
// Safe to raise: the PHONE never waits this long. vapi-tool races its own 4.5s cap and
// speaks a keep-talking fallback, so callers still never hit dead air. This budget is what
// the office board, the customer portal and the text surfaces get, and they can wait.
const JOB_TRUTH_FETCH_TIMEOUT_MS = Number(process.env.JOB_TRUTH_FETCH_TIMEOUT_MS || 12000);
async function jfetch(url, opts, timeoutMs) {
  try {
    const r = await fetch(url, { ...(opts || {}), signal: AbortSignal.timeout(timeoutMs || JOB_TRUTH_FETCH_TIMEOUT_MS) });
    return await r.json();
  } catch (_) { return null; }
}
function post(path, body) { return jfetch(`${XANO}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

// The scheduled DAY, always in America/Chicago. (Fixed 2026-07-22: a string-typed
// scheduled_start used to format in the SERVER's timezone (UTC), so an evening-CT
// appointment rolled to the next day — Thursday read as Friday on BOTH the text and
// the phone, because both pull the day from here.)
function dayCT(v) {
  if (v == null || v === '') return '';
  let ms;
  if (typeof v === 'number') {
    ms = v;
  } else {
    const s = String(v).trim();
    const plain = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);   // "YYYY-MM-DD" only, no time
    if (plain) {
      // Anchor at NOON so the calendar day can never slip across a timezone.
      ms = Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]), 12, 0, 0);
    } else {
      ms = Date.parse(s);   // ISO / datetime string
    }
  }
  if (!ms || isNaN(ms)) return typeof v === 'string' ? v : '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
}
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const term = (s) => /cancel|complete|no_fix/i.test(String(s || ''));

// Latest office note for a job. This is the slow call (~4s, scans all notes) so
// it's fired in PARALLEL with the main lookup and hard-capped — if it's slow, we
// return the status answer without it rather than make the whole thing crawl.
async function fetchOfficeNote(jid, timeoutMs) {
  if (!jid) return '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 4000);
    const el = await (await fetch(`${XANO}/get_event_log_by_action?action=office_note`, { signal: ctl.signal })).json().catch(() => null);
    clearTimeout(timer);
    const rows = (el && (el.items || el)) || [];
    const mine = (Array.isArray(rows) ? rows : []).map((x) => { const m = metaOf(x); return { text: m.text || '', jid: Number(m.job_id || 0), at: Number(m.at_ms || 0) || Date.parse(x.created_at) || 0 }; })
      .filter((x) => x.jid === Number(jid) && x.text).sort((a, b) => b.at - a.at);
    return mine.length ? mine[0].text : '';
  } catch (_) { return ''; }
}

// ── the Supabase mirror: the same job, without waiting on Xano ─────────────────
//
// Teddy 2026-09-10, both systems freezing: Xano's get_job_for_dashboard measured 4.1s
// typical and once hung past 40s while the office was live, and the office-note scan
// costs another ~4s on top. When those miss, job-truth returns found:false — which the
// phone speaks as "I don't see that one yet," about a real job scheduled that same day.
//
// The platform mirror already holds every one of these facts (platform-tn-mirror runs
// every 5 min and stamps updated_at), including office_notes — so the whole answer can
// come from one indexed Postgres read instead of two slow Xano calls.
//
// Order: mirror first when the row is FRESH, Xano as the fallback. Freshness matters
// because a stale day read aloud confidently is the one failure worse than a slow one.
// If the row is stale we go to Xano; and if Xano then fails, we'd rather serve the
// slightly-stale mirror row than tell a real customer we've never heard of them.
//
// Reversible in one move: JOB_TRUTH_MIRROR=0 turns this off and everything is Xano again.
const MIRROR_ON = String(process.env.JOB_TRUTH_MIRROR || '1') !== '0';
const MIRROR_FRESH_MS = Number(process.env.JOB_TRUTH_MIRROR_FRESH_MS || 30 * 60 * 1000);
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const MIRROR_TIMEOUT_MS = 4000;

// One select, every table the facts need. Column names are mapped to the Xano-shaped
// field names buildFacts already reads, so the lenses are untouched.
const MIRROR_SELECT =
  'xano_id,status,xano_status,xano_current_status,scheduled_day,scheduled_start,claim_number,' +
  'warranty_company,parts_status,parts_eta,office_notes,availability,access_notes,problem,' +
  'tdr_diagnosis,tdr_failed_component,tdr_part_number,tdr_repair_completed,updated_at,' +
  'customer:customer_id(first_name,last_name,phone,address,city,state,zip),' +
  'technician:technician_id(name,xano_tech_id),' +
  'unit:unit_id(kind,label,attributes)';

// The URL is a public default inside secrets.js, not a Netlify env var, so it has to be
// asked for rather than read off process.env. Memoized: this runs on every lookup.
let _sbCfg = null;
async function mirrorCfg() {
  if (!_sbCfg) {
    _sbCfg = (async () => {
      const [base, key] = await Promise.all([getSecret('PLATFORM_SUPABASE_URL'), getSecret('PLATFORM_SUPABASE_SERVICE_KEY')]);
      return { base: base || '', key: key || '' };
    })();
  }
  return _sbCfg;
}

async function mirrorGet(filter) {
  const { base, key } = await mirrorCfg();
  if (!base || !key) return null;
  const url = `${base}/rest/v1/job?company_id=eq.${TN_COMPANY}&select=${encodeURIComponent(MIRROR_SELECT)}&${filter}`;
  try {
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : null;
  } catch (_) { return null; }
}

// Reshape a mirror row into exactly what resolve() hands buildFacts, so nothing
// downstream has to know where the answer came from.
function shapeMirror(m) {
  const c = m.customer || {}, t = m.technician || {}, u = m.unit || {};
  const attrs = (u && u.attributes) || {};
  const job = {
    id: Number(m.xano_id) || 0,
    current_status: m.xano_current_status || '',
    scheduling_status: m.xano_status || m.status || '',
    claim_number: m.claim_number || '',
    warranty_company: m.warranty_company || '',
    // The mirror only stores a warranty company when there is one, so a blank means
    // self-pay — which is what buildFacts already infers from an empty customer_type.
    customer_type: m.warranty_company ? 'warranty' : '',
    brand: attrs.brand || '',
    appliance_type: attrs.appliance || u.kind || '',
    model_number: attrs.model || attrs.model_number || '',
    // TECHS is keyed by the XANO tech id, so hand it that and the names still resolve.
    technician_id: Number(t.xano_tech_id) || 0,
    scheduled_start: m.scheduled_start || m.scheduled_day || null,
    part_eta: m.parts_eta || null,
    parts_status: m.parts_status || '',
    customer_preference_text: m.availability || '',
    access_notes: m.access_notes || '',
    problem_summary: m.problem || '',
    service_address: c.address || '', service_city: c.city || '',
    service_state: c.state || '', service_zip: c.zip || '',
  };
  const tech = t.xano_tech_id ? { id: Number(t.xano_tech_id), name: t.name || '' } : null;
  const cust = (c.first_name || c.last_name || c.phone)
    ? { first_name: c.first_name || '', last_name: c.last_name || '', phone: c.phone || '', state: c.state || '' }
    : null;
  const tdr = (m.tdr_diagnosis || m.tdr_failed_component || m.tdr_part_number)
    ? { diagnosis: m.tdr_diagnosis || '', failed_component: m.tdr_failed_component || '',
        verified_part_number: m.tdr_part_number || '', repair_completed: m.tdr_repair_completed || '' }
    : null;
  // all_tdrs stays EMPTY on purpose: the mirror flattens every report into one set of
  // tdr_* columns, so there is no way to tell Teddy's pre-diagnosis apart from the
  // tech's. An empty pre_diagnosis is honest; a mislabeled one is not.
  return {
    job, tech, cust,
    dash: { job, tech, customer: cust, tdr, all_tdrs: [], appliance: { brand: job.brand, appliance_type: job.appliance_type, model_number: job.model_number } },
    claim: job.claim_number,
    office_note: (m.office_notes || '').trim(),
    mirror_age_ms: Math.max(0, Date.now() - (Date.parse(m.updated_at) || 0)),
  };
}

// Find the job in the mirror by the same three keys the Xano path accepts.
async function resolveFromMirror(q) {
  if (!MIRROR_ON) return null;
  let rows = null;
  if (q.job_id) {
    rows = await mirrorGet(`xano_id=eq.${Number(q.job_id)}&limit=1`);
  } else if (q.claim) {
    const cl = String(q.claim).trim();
    // Prefer a live job on this claim over a canceled duplicate — the same
    // canceled→active rule the Xano path applies, done in the query.
    rows = await mirrorGet(`claim_number=eq.${encodeURIComponent(cl)}&status=not.in.(canceled)&order=updated_at.desc&limit=1`)
        || null;
    if (!rows || !rows.length) rows = await mirrorGet(`or=(claim_number.eq.${encodeURIComponent(cl)},dispatch_id.eq.${encodeURIComponent(cl)})&order=updated_at.desc&limit=1`);
  } else if (q.phone) {
    const d = String(q.phone).replace(/\D/g, '').slice(-10);
    if (!d) return null;
    const { base, key } = await mirrorCfg();
    if (!base || !key) return null;
    // Platform phones are stored in mixed formats, so match on the last 10 digits
    // (the same rule the platform call-lookup uses) rather than the raw string.
    try {
      const cu = `${base}/rest/v1/customer?company_id=eq.${TN_COMPANY}&select=id&phone=like.*${d.slice(-7)}*&limit=25`;
      const cr = await fetch(cu, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS) });
      const cs = cr.ok ? await cr.json() : [];
      const ids = (Array.isArray(cs) ? cs : []).map((x) => x.id).filter(Boolean);
      if (!ids.length) return null;
      rows = await mirrorGet(`customer_id=in.(${ids.join(',')})&status=not.in.(completed,canceled)&order=updated_at.desc&limit=1`);
      if (!rows || !rows.length) rows = await mirrorGet(`customer_id=in.(${ids.join(',')})&order=updated_at.desc&limit=1`);
    } catch (_) { return null; }
  }
  if (!rows || !rows.length || !rows[0]) return null;
  const shaped = shapeMirror(rows[0]);
  return shaped.job.id ? shaped : null;
}

// ── resolve to the ONE real job (job_id / claim / phone), canceled→active ──
async function resolve(q) {
  let job = null, tech = null, cust = null, dash = null, claim = q.claim || '';
  if (q.job_id) {
    dash = await post('get_job_for_dashboard', { job_id: Number(q.job_id) });
    job = dash && dash.job;
  } else if (claim) {
    const d = await post('lookup_by_claim_number', { claim_or_dispatch_number: claim });
    if (d && d.success && (d.matches || []).length) { job = d.matches[0]; tech = d.tech; cust = d.customer; }
  } else if (q.phone) {
    const d = await jfetch(`${XANO}/lookup_customer_by_phone?phone=${String(q.phone).replace(/\D/g, '')}`);
    // lookup_customer_by_phone returns open_jobs[] + recent_jobs[] (NOT jobs/job — that
    // typo made every phone lookup return nothing). Prefer a live (non-terminal) open
    // job so we greet on the real active job, not a canceled dispatch shell; fall back
    // to the newest recent job so a returning customer is still recognized by name.
    if (d && d.found) {
      cust = d.customer;
      const pool = ((d.open_jobs && d.open_jobs.length) ? d.open_jobs : (d.recent_jobs || []));
      job = pool.find((jj) => !term(jj.current_status || jj.scheduling_status)) || pool[0]
        || (d.jobs && d.jobs[0]) || d.job || null;
      tech = d.tech || d.technician || tech;
    }
  }
  if (!job) return { job: null };

  // canceled duplicate → the customer's ACTIVE job on the same claim
  const st0 = String(job.current_status || job.scheduling_status || '').toLowerCase();
  if (/cancel/.test(st0)) {
    let cno = job.claim_number || claim;
    if (!cno && (job.id || q.job_id)) {
      const es = await jfetch(`${XANO}/get_job_event_stream?job_id=${job.id || q.job_id}`);
      cno = (es && es.current_state && es.current_state.job && es.current_state.job.claim_number) || '';
    }
    if (cno) {
      const cl = await post('lookup_by_claim_number', { claim_or_dispatch_number: cno });
      const active = ((cl && cl.matches) || []).find((m) => !term(m.current_status || m.scheduling_status));
      if (active) { job = active; claim = cno; if (cl && cl.tech) tech = cl.tech; if (cl && cl.customer) cust = cl.customer; }
    }
  }

  // Always load the rich detail for the resolved job (tdr, all_tdrs, tech, cust, appliance).
  const jid = Number(job.id || q.job_id) || 0;
  if (jid && (!dash || Number((dash.job || {}).id) !== jid)) dash = await post('get_job_for_dashboard', { job_id: jid });
  if (dash && dash.job) job = dash.job;
  tech = (dash && dash.tech) || tech;
  cust = (dash && dash.customer) || cust;
  return { job, tech, cust, dash, claim: claim || job.claim_number || '' };
}

// ── the resolved facts every lens is built from ──
async function buildFacts(r, officeNote) {
  const { job, tech, cust, dash } = r;
  const rawCur = String(job.current_status || '').toLowerCase();
  const rawSched = String(job.scheduling_status || '').toLowerCase();
  let status = rawCur || rawSched;
  if (rawCur === 'canceled' && rawSched && rawSched !== 'canceled') status = rawSched;   // stale-cancel guard

  const appliance = [job.brand || (dash && dash.appliance && dash.appliance.brand), job.appliance_type || (dash && dash.appliance && dash.appliance.appliance_type)].filter(Boolean).join(' ') || 'appliance';
  const tdr = (dash && dash.tdr) || null;
  const allTdrs = (dash && dash.all_tdrs) || [];
  const preDiag = (allTdrs.find((t) => Number(t.technician_id) === 1) || {}).diagnosis || '';
  const ct = String(job.customer_type || '').toLowerCase();
  const isWarranty = !!(job.warranty_company || (ct && !/self|cash|customer_pay/.test(ct)));

  const jid = Number(job.id) || 0;
  officeNote = officeNote || '';   // fetched in PARALLEL by the handler

  // Source the tech + state ROBUSTLY. get_job_for_dashboard hands the tech as
  // { id, name } (NOT technician_id on the job, NOT first_name), and the job row
  // omits service_state — but the customer carries state. Reading the old field
  // names silently found nothing, so job-truth could never name the tech ("she
  // doesn't know who my tech is"). Pull techId from tech.id, the first name from a
  // TECHS map (or the full name), and the state from the customer when the job lacks it.
  const techId = Number(job.technician_id) || Number(tech && tech.id) || 0;
  const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';
  const realTechName = TECHS[techId] || firstWord(tech && tech.name) || (tech && tech.first_name) || '';
  const jobState = String(job.service_state || (cust && cust.state) || '').trim();

  // ZONE-SAFE tech name for OUTWARD lenses. Keep the real assigned name in
  // `tech_name` (office/tech lenses need it — that's how the office spots + fixes a
  // bad assignment), but never let Ann SAY a tech whose state doesn't match the job's
  // state. Mid-churn (a job briefly on the wrong tech) she'll say "your technician"
  // instead of "Jimmy" on a Louisiana job — honest, never confidently wrong.
  const techZoneOk = techCoversState(techId, jobState);

  return {
    job_id: jid, claim_number: job.claim_number || r.claim || '',
    customer_name: cust ? `${(cust.first_name || '').trim()} ${(cust.last_name || '').trim()}`.trim() : '',
    customer_first: (cust && cust.first_name) || '',
    customer_phone: (cust && cust.phone) || job.customer_phone || '',
    appliance, model: job.model_number || job.appliance_model || (dash && dash.appliance && dash.appliance.model_number) || '',
    status, is_warranty: isWarranty, warranty_company: (job.warranty_company || '').trim(),
    tech_name: realTechName,
    tech_name_safe: techZoneOk ? realTechName : '',   // outward lenses use this
    tech_zone_ok: techZoneOk,
    service_state: jobState,
    technician_id: techId,
    scheduled_day: dayCT(job.scheduled_start),
    scheduled_start_ms: (function () { const v = job.scheduled_start; if (!v) return 0; const ms = typeof v === 'string' ? Date.parse(v) : Number(v); return isNaN(ms) ? 0 : ms; })(),
    // Has the stated appointment day already PASSED? (Teddy 2026-09-08: the AI was
    // telling live customers "you're scheduled for Thursday, Sep 3" on Sep 8 — 131 open
    // jobs carried a scheduled day in the past. Reading a stale date aloud as if it were
    // upcoming is the single worst thing the phone can do to trust.) Compare CT calendar
    // days, not raw ms, so an appointment EARLIER TODAY is still "today", not past.
    scheduled_is_past: (function () {
      const v = job.scheduled_start; if (!v) return false;
      const ms = typeof v === 'string' ? Date.parse(v) : Number(v);
      if (!ms || isNaN(ms)) return false;
      const ct = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      return ct(ms) < ct(Date.now());
    })(),
    part_eta: dayCT(job.part_eta || job.parts_eta_date),
    part_number: (tdr && tdr.verified_part_number) || '',
    failed_component: (tdr && tdr.failed_component) || '',
    diagnosis: (tdr && tdr.diagnosis) || '',
    pre_diagnosis: preDiag,
    // Ready-to-say line for warranty reps who ask to close out the claim so they
    // can issue a recall (Teddy 7/3): don't close it — we finish on the original
    // claim; funnel the customer into a text to us so they land back on schedule.
    recall_redirect: `No need to close this out for a recall — we're happy to come back out on the original claim. The fastest way: have ${(cust && cust.first_name) || 'the customer'} text us at 615-588-9500 with their info and we'll get them right back on our schedule. Saves everyone the time and paperwork.`,
    availability: (job.customer_preference_text || '').trim(),
    access_notes: (job.access_notes || '').trim(),
    address: [job.service_address, job.service_city, job.service_state, job.service_zip].filter(Boolean).join(', '),
    problem: (job.problem_summary || job.problem_description || '').trim(),
    office_note: officeNote,
    tdr_complete: !!(tdr && (/complete|done/i.test(String(tdr.status || '')) || tdr.repair_completed)),
    has_part_number: !!(tdr && tdr.verified_part_number),
  };
}

// ── the four lenses (thin — each just phrases the shared facts) ──
function lensCustomer(f) {
  const ap = 'your ' + f.appliance, t = f.tech_name_safe || 'your tech';
  if (/complete|done/.test(f.status)) {
    if (f.is_warranty) return `Our records show this repair was completed. If ${ap} is having trouble again, it has to go back through your warranty company as a recall — please contact ${f.warranty_company || 'your warranty company'} and open a recall on this claim, and they'll dispatch us back out. We can't schedule a return until that recall is opened.`;
    return `Your repair is complete — thank you!`;
  }
  if (/cancel/.test(f.status)) return `Let me get you taken care of — I'll have our office confirm your appointment and reach right back out.`;
  if (/await|part|order/.test(f.status)) return f.part_eta ? `We've diagnosed ${ap} and we're waiting on the part — expected ${f.part_eta}. The moment it's in we'll schedule the install and text you a day.` : `We've diagnosed ${ap} and the part is on order. As soon as it arrives we'll schedule the install and text you a day.`;
  if (/in_progress|started/.test(f.status)) return `${t} is working on ${ap} right now.`;
  if (/scheduled/.test(f.status) || f.scheduled_day) {
    // The day on the record already passed -> we do NOT know when they're coming. Say so
    // honestly and hand to a human rather than reading a stale date back as upcoming.
    if (f.scheduled_is_past) return `I want to get you an accurate day — the appointment on your record has already passed, so let me have our office confirm your new day and text you right back.`;
    return f.scheduled_day ? `You're scheduled with ${t} for ${f.scheduled_day}. We run day-of routing, so you'll get a live arrival window that morning.` : `You're scheduled with ${t} — you'll get a live window the morning of.`;
  }
  return `We've got ${ap} and it's in our scheduling queue — we'll set a day shortly and text you to confirm.`;
}
// Warranty rep lens — answer the whole status in ONE breath (Teddy 7/3): reps
// call to check the same 5-6 things, so volunteer everything we have to end the
// call in one turn — has the tech been out, what we found, the part + ETA, and
// the return/scheduled day. (The recall close-out redirect is f.recall_redirect,
// used as a conversational branch when they ask to close out for a recall.)
function lensWarranty(f) {
  const who = f.customer_first || 'the customer', t = f.tech_name_safe || 'our tech';
  const done = /complete|done/.test(f.status);
  const awaiting = /await|part|order/.test(f.status);
  const inprog = /in_progress|started/.test(f.status);
  const scheduled = /scheduled/.test(f.status) || !!f.scheduled_day;
  const canceled = /cancel/.test(f.status);
  const finding = f.failed_component || f.diagnosis || '';
  const beenOut = done || inprog || awaiting || !!finding;
  const bits = [];

  // 1) has the tech been out?
  if (done) bits.push(`Yes — ${t} has been out and this repair is completed and closed${f.part_number ? ' (part ' + f.part_number + ')' : ''}.`);
  else if (inprog) bits.push(`${t} is on site with ${who} right now.`);
  else if (beenOut) bits.push(`Yes, ${t} has already been out and diagnosed it.`);
  else if (scheduled && f.scheduled_is_past) bits.push(`Not out yet — the scheduled day on this claim (${f.scheduled_day}) has already passed and our office is confirming a new day; I'll have that texted over.`);
  else if (scheduled) bits.push(`Not out yet — ${who} is scheduled with ${t}${f.scheduled_day ? ' for ' + f.scheduled_day : ''}; we run day-of routing, so they get a live arrival window that morning.`);
  else if (canceled) bits.push(`Status is being confirmed by our office — please don't treat this as canceled; we'll update the claim shortly.`);
  else bits.push(`Not out yet — it's in our scheduling queue and we're setting a day.`);

  // 2) what we found (skip on completed — already implied)
  if (finding && !done) bits.push(`We found ${finding}.`);

  // 3) part + ETA + the return
  if (awaiting) bits.push(`The part${f.part_number ? ' (' + f.part_number + ')' : ''} is on order${f.part_eta ? ', ETA ' + f.part_eta : ''}, and we go straight back to install the moment it lands.`);
  else if (scheduled && !done && f.scheduled_day && !f.scheduled_is_past) bits.push(`We're set to return ${f.scheduled_day}.`);

  return bits.join(' ') + (f.office_note ? ` Latest office note: ${f.office_note}.` : '');
}
function lensTech(f) {
  const bits = [];
  bits.push(`${f.customer_name || 'Customer'} — ${f.appliance}${f.model ? ' (' + f.model + ')' : ''}${f.problem ? ': ' + f.problem : ''}.`);
  if (f.pre_diagnosis) bits.push(`Teddy's pre-diag: ${f.pre_diagnosis}.`);
  if (f.part_number) bits.push(`Part: ${f.part_number}${f.part_eta ? ' (ETA ' + f.part_eta + ')' : ''}.`);
  if (f.availability) bits.push(`Availability: "${f.availability}".`);
  if (f.access_notes) bits.push(`Access: ${f.access_notes}.`);
  if (f.scheduled_day) bits.push(`Day: ${f.scheduled_day}.${f.scheduled_is_past ? ' \u26a0 PAST DUE - day already passed, needs rescheduling' : ''}`);
  if (f.office_note) bits.push(`Office: ${f.office_note}.`);
  return bits.join(' ');
}
function lensOffice(f) {
  const bits = [`#${f.job_id} ${f.customer_name} — ${f.appliance} — ${f.status}${f.tech_name ? ' · ' + f.tech_name : ' · NO TECH'}${f.scheduled_day ? ' · ' + f.scheduled_day : ''}.`];
  if (f.scheduled_is_past && !/complete|cancel/.test(String(f.status || ''))) bits.push(`\u26a0\ufe0f PAST DUE — ${f.scheduled_day} already passed, needs rescheduling.`);
  if (/await|part|order/.test(f.status)) bits.push(f.part_eta ? `Part ETA ${f.part_eta}.` : `Part on order — ETA not set.`);
  if (f.tdr_complete && !f.has_part_number) bits.push(`⚠️ Report in but NO part # — get it from ${f.tech_name || 'the tech'} before closing.`);
  if (!f.technician_id) bits.push(`⚠️ No tech assigned.`);
  if (f.technician_id && !f.tech_zone_ok) bits.push(`⚠️ ${f.tech_name || 'That tech'} is OUT OF ZONE for ${f.service_state || 'this job'} — reassign to a ${f.service_state || 'local'} tech.`);
  if (f.office_note) bits.push(`Note: ${f.office_note}.`);
  return bits.join(' ');
}

exports.handler = async function (event) {
  let q = (event && event.queryStringParameters) || {};
  if (event.httpMethod === 'POST') { try { q = Object.assign({}, q, JSON.parse(event.body || '{}')); } catch (_) {} }
  const lens = String(q.lens || 'all').toLowerCase();

  if (!q.job_id && !q.claim && !q.phone) return ok({ ok: false, error: 'need job_id, claim, or phone' });

  // Ask the mirror first. When it has a FRESH row this answers the whole thing from one
  // Postgres read - no get_job_for_dashboard, no office-note scan - which is the
  // difference between a 4-40s Xano round trip and ~0.3s. See resolveFromMirror above.
  // ?src=xano forces the legacy path for one request. This is how the two answers get
  // compared on real jobs without flipping the flag for everybody.
  const forceXano = String(q.src || '').toLowerCase() === 'xano';
  const mirrored = forceXano ? null : await resolveFromMirror(q).catch(() => null);
  const mirrorFresh = !!(mirrored && mirrored.mirror_age_ms <= MIRROR_FRESH_MS);

  let r = mirrorFresh ? mirrored : null;
  let officeNote = mirrorFresh ? mirrored.office_note : '';
  let source = mirrorFresh ? 'mirror' : '';

  if (!r) {
    // Fire the slow office-note fetch in PARALLEL with the main lookup when we know
    // the job_id up front (the common path — board/tech/portal). Cuts ~4s off.
    const jid0 = Number(q.job_id) || 0;
    const notePromise = jid0 ? fetchOfficeNote(jid0) : null;
    const xr = await resolve(q);
    if (xr && xr.job) {
      r = xr; source = 'xano';
      const jid = Number(xr.job.id) || 0;
      officeNote = (notePromise && jid === jid0) ? await notePromise : await fetchOfficeNote(jid);
    } else if (notePromise) {
      // don't leave the parallel fetch dangling
      try { await notePromise; } catch (_) {}
    }
  }

  // Xano missed and we DO have a mirror row, just an older one. Serve it. A day that is
  // a few minutes stale beats telling a real customer we have never heard of them -
  // which is exactly what was happening every time Xano timed out.
  if (!r && mirrored) { r = mirrored; officeNote = mirrored.office_note; source = 'mirror_stale'; }

  if (!r || !r.job) return ok({ ok: true, found: false, reason: "I don't see that one yet — it may be a brand-new dispatch we haven't received. I can take the details and have someone confirm." });

  const facts = await buildFacts(r, officeNote);
  const all = { customer: lensCustomer(facts), warranty: lensWarranty(facts), tech: lensTech(facts), office: lensOffice(facts) };
  const lenses = (lens === 'all') ? all : { [lens]: all[lens] || all.customer };

  return ok({ ok: true, found: true, job_id: facts.job_id, source, facts, lenses });
};
