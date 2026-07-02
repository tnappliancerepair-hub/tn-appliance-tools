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
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

async function jfetch(url, opts) { try { const r = await fetch(url, opts); return await r.json(); } catch (_) { return null; } }
function post(path, body) { return jfetch(`${XANO}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

function dayCT(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  let ms = typeof v === 'string' ? Date.parse(v) : v;
  if (!ms || isNaN(ms)) return '';
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
    if (d && d.found) { cust = d.customer; job = (d.jobs && d.jobs[0]) || d.job || null; tech = d.tech; }
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

  return {
    job_id: jid, claim_number: job.claim_number || r.claim || '',
    customer_name: cust ? `${(cust.first_name || '').trim()} ${(cust.last_name || '').trim()}`.trim() : '',
    customer_first: (cust && cust.first_name) || '',
    customer_phone: (cust && cust.phone) || job.customer_phone || '',
    appliance, model: job.model_number || job.appliance_model || (dash && dash.appliance && dash.appliance.model_number) || '',
    status, is_warranty: isWarranty, warranty_company: (job.warranty_company || '').trim(),
    tech_name: (tech && tech.first_name) || TECHS[job.technician_id] || '',
    technician_id: job.technician_id || 0,
    scheduled_day: dayCT(job.scheduled_start),
    part_eta: dayCT(job.part_eta || job.parts_eta_date),
    part_number: (tdr && tdr.verified_part_number) || '',
    failed_component: (tdr && tdr.failed_component) || '',
    pre_diagnosis: preDiag,
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
  const ap = 'your ' + f.appliance, t = f.tech_name || 'your tech';
  if (/complete|done/.test(f.status)) {
    if (f.is_warranty) return `Our records show this repair was completed. If ${ap} is having trouble again, it has to go back through your warranty company as a recall — please contact ${f.warranty_company || 'your warranty company'} and open a recall on this claim, and they'll dispatch us back out. We can't schedule a return until that recall is opened.`;
    return `Your repair is complete — thank you!`;
  }
  if (/cancel/.test(f.status)) return `Let me get you taken care of — I'll have our office confirm your appointment and reach right back out.`;
  if (/await|part|order/.test(f.status)) return f.part_eta ? `We've diagnosed ${ap} and we're waiting on the part — expected ${f.part_eta}. The moment it's in we'll schedule the install and text you a day.` : `We've diagnosed ${ap} and the part is on order. As soon as it arrives we'll schedule the install and text you a day.`;
  if (/in_progress|started/.test(f.status)) return `${t} is working on ${ap} right now.`;
  if (/scheduled/.test(f.status) || f.scheduled_day) return f.scheduled_day ? `You're scheduled with ${t} for ${f.scheduled_day}. We run day-of routing, so you'll get a live arrival window that morning.` : `You're scheduled with ${t} — you'll get a live window the morning of.`;
  return `We've got ${ap} and it's in our scheduling queue — we'll set a day shortly and text you to confirm.`;
}
function lensWarranty(f) {
  const who = f.customer_first || 'the customer', ap = 'the ' + f.appliance, t = f.tech_name || 'a tech';
  let base;
  if (/complete|done/.test(f.status)) base = `This repair is completed and closed${f.part_number ? ' (part ' + f.part_number + ')' : ''}. If ${ap} is acting up again it must come back as a RECALL from ${f.warranty_company || 'the warranty company'} — we can't reschedule until it's re-dispatched.`;
  else if (/await|part|order/.test(f.status)) base = `Diagnosed; awaiting part${f.part_number ? ' ' + f.part_number : ''}${f.part_eta ? ' (ETA ' + f.part_eta + ')' : ''}. We schedule the install as soon as it lands.`;
  else if (/in_progress|started/.test(f.status)) base = `${t} is on site now for ${who}.`;
  else if (/scheduled/.test(f.status) || f.scheduled_day) base = `${who} is scheduled with ${t}${f.scheduled_day ? ' for ' + f.scheduled_day : ''} (day-of routing; live window the morning of).`;
  else if (/cancel/.test(f.status)) base = `Status is being confirmed by our office — do not treat as canceled; we'll update the claim shortly.`;
  else base = `Received and in our scheduling queue; a day is being set.`;
  return base + (f.office_note ? ` Latest note: ${f.office_note}` : '');
}
function lensTech(f) {
  const bits = [];
  bits.push(`${f.customer_name || 'Customer'} — ${f.appliance}${f.model ? ' (' + f.model + ')' : ''}${f.problem ? ': ' + f.problem : ''}.`);
  if (f.pre_diagnosis) bits.push(`Teddy's pre-diag: ${f.pre_diagnosis}.`);
  if (f.part_number) bits.push(`Part: ${f.part_number}${f.part_eta ? ' (ETA ' + f.part_eta + ')' : ''}.`);
  if (f.availability) bits.push(`Availability: "${f.availability}".`);
  if (f.access_notes) bits.push(`Access: ${f.access_notes}.`);
  if (f.scheduled_day) bits.push(`Day: ${f.scheduled_day}.`);
  if (f.office_note) bits.push(`Office: ${f.office_note}.`);
  return bits.join(' ');
}
function lensOffice(f) {
  const bits = [`#${f.job_id} ${f.customer_name} — ${f.appliance} — ${f.status}${f.tech_name ? ' · ' + f.tech_name : ' · NO TECH'}${f.scheduled_day ? ' · ' + f.scheduled_day : ''}.`];
  if (/await|part|order/.test(f.status)) bits.push(f.part_eta ? `Part ETA ${f.part_eta}.` : `Part on order — ETA not set.`);
  if (f.tdr_complete && !f.has_part_number) bits.push(`⚠️ Report in but NO part # — get it from ${f.tech_name || 'the tech'} before closing.`);
  if (!f.technician_id) bits.push(`⚠️ No tech assigned.`);
  if (f.office_note) bits.push(`Note: ${f.office_note}.`);
  return bits.join(' ');
}

exports.handler = async function (event) {
  let q = (event && event.queryStringParameters) || {};
  if (event.httpMethod === 'POST') { try { q = Object.assign({}, q, JSON.parse(event.body || '{}')); } catch (_) {} }
  const lens = String(q.lens || 'all').toLowerCase();

  if (!q.job_id && !q.claim && !q.phone) return ok({ ok: false, error: 'need job_id, claim, or phone' });

  // Fire the slow office-note fetch in PARALLEL with the main lookup when we know
  // the job_id up front (the common path — board/tech/portal). Cuts ~4s off.
  const jid0 = Number(q.job_id) || 0;
  const notePromise = jid0 ? fetchOfficeNote(jid0) : null;

  const r = await resolve(q);
  if (!r.job) return ok({ ok: true, found: false, reason: "I don't see that one yet — it may be a brand-new dispatch we haven't received. I can take the details and have someone confirm." });

  const jid = Number(r.job.id) || 0;
  const officeNote = (notePromise && jid === jid0) ? await notePromise : await fetchOfficeNote(jid);
  const facts = await buildFacts(r, officeNote);
  const all = { customer: lensCustomer(facts), warranty: lensWarranty(facts), tech: lensTech(facts), office: lensOffice(facts) };
  const lenses = (lens === 'all') ? all : { [lens]: all[lens] || all.customer };

  return ok({ ok: true, found: true, job_id: facts.job_id, facts, lenses });
};
