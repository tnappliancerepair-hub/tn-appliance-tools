// tdr-submit-watch — Teddy Tool submission alerts: EMAIL (tracking) + AREA-TECH TEXT.
//
// Teddy (2026-06-29): "Texts should be sent for cash jobs and Teddy Tool submitted.
// Teddy Tools submitted should also be sent to the techs that work that area."
//
// When a diagnosis is filed from the Teddy Tool (create_tdr → event_log action
// 'create_tdr'), this:
//   1. EMAILS tnappliancerepair@gmail.com a record (the tracking channel Teddy wants)
//   2. TEXTS the area tech the diagnosis + tech-job link — the tech who'll do the job
//      gets a real-time heads-up. Area tech = the job's assigned tech, else the
//      cluster rank-1 for the zip (check_service_zone).
//
// Dedup by TDR event id so each submission notifies once. The TEXT to the tech is
// LIVE now (techs bypass the customer SMS gate). The EMAIL is dormant until email is
// turned on (EMAIL_ENABLED=true + SES verify) — dry-runs safely. ?dry=1 lists recent
// submissions + who would be notified.
//
//   scheduled every 15 min   notify on new Teddy Tool submissions
//   GET ?dry=1[&days=2]      list recent submissions, send nothing
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { sendSms } = require('./_lib/sms');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TO = process.env.TDR_EMAIL_TO || 'tnappliancerepair@gmail.com';

// Tech roster (phones bypass the customer gate in send_sms). Andre = 504.
const TECH = {
  1: { p: '+16154855795', n: 'Teddy' }, 2: { p: '+16159671304', n: 'Jimmy' },
  3: { p: '+15049099413', n: 'Andre' }, 4: { p: '+16158291654', n: 'Lee' },
  6: { p: '+18133527686', n: 'John' },
};

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ctTime(ms) { if (!ms) return ''; try { return new Date(Number(ms)).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } }
async function getJson(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); return await r.json(); } catch (_) { return null; } }

// Resolve the area tech for a job: assigned tech wins, else cluster rank-1 by zip.
async function areaTechFor(job) {
  const assigned = Number(job && job.technician_id);
  if (assigned && TECH[assigned]) return { id: assigned, ...TECH[assigned], how: 'assigned' };
  const zip = (job && (job.zip || job.zip_code || job.service_zip)) || '';
  if (zip) {
    const z = await getJson(`${XANO}/check_service_zone?zip_code=${encodeURIComponent(zip)}`);
    const id = z && Number(z.suggested_technician_id);
    if (id && TECH[id]) return { id, ...TECH[id], how: 'cluster', cluster: z.cluster };
    if (id) return { id, n: (z && z.suggested_tech_name) || ('tech ' + id), p: null, how: 'cluster_nophone', cluster: z && z.cluster };
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dry === '1';
  const days = Math.max(1, Math.min(10, parseInt(q.days, 10) || 2));
  const sinceMs = Date.now() - days * 86400000;

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'create_tdr' }, { id: 'desc' }, 120); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  const subs = (rows || []).filter((r) => { const c = Number(r.created_at || 0); return !c || c >= sinceMs; }).map((r) => {
    const m = meta(r); return { id: r.id, job_id: m.job_id || m.jobId || null, tdr_id: m.tdr_id || null, at: ctTime(m.at_ms || r.created_at) };
  }).filter((s) => s.job_id);

  // dedup — which TDR event ids already notified?
  const done = new Set();
  try {
    const sent = await crud.searchPage(crud.TABLES.event_log, { action: 'tdr_submit_notified' }, { id: 'desc' }, 80);
    for (const r of sent || []) { for (const id of (meta(r).ids || [])) done.add(Number(id)); }
  } catch (_) {}

  const fresh = subs.filter((s) => !done.has(Number(s.id)));
  const out = { ok: true, dry, recent_submissions: subs.length, new: fresh.length };

  // enrich fresh ones with job + area-tech (cap to protect runtime)
  const work = fresh.slice(0, 12);
  for (const s of work) {
    const job = await getJson(`${XANO}/get_job_for_dashboard?job_id=${s.job_id}`);
    const j = (job && (job.job || job)) || {};
    s.customer = j.customer_name || (j.customer && (j.customer.full_name || j.customer.name)) || '';
    s.appliance = j.appliance_type || j.appliance || '';
    s.brand = j.brand || '';
    s.problem = j.problem_summary || j.problem || '';
    s.tech = await areaTechFor(j);
  }

  if (dry) { out.submissions = work; return json(200, out); }
  if (!work.length) { out.note = 'no new Teddy Tool submissions — nothing sent'; return json(200, out); }

  // 1. TEXT the area tech (live now — techs bypass the customer gate)
  const texted = [];
  for (const s of work) {
    if (!s.tech || !s.tech.p) { texted.push({ job: s.job_id, sms: 'skip_no_tech_phone', who: s.tech && s.tech.n }); continue; }
    const link = `${SITE}/tech-job.html?job_id=${s.job_id}&tech_id=${s.tech.id}`;
    const body = `🔧 Diagnosis filed — job #${s.job_id}${s.customer ? ' (' + s.customer + ')' : ''}\n${[s.brand, s.appliance].filter(Boolean).join(' ')}${s.problem ? ' — ' + s.problem : ''}\nYou're the area tech. Details + parts: ${link}`;
    const ok = await sendSms(s.tech.p, body, 'technician', 'tdr_submit');
    texted.push({ job: s.job_id, who: s.tech.n, sms: ok ? 'sent' : 'failed' });
  }

  // 2. EMAIL the tracking record (dormant until EMAIL_ENABLED=true)
  const lineFor = (s) => `Job #${s.job_id}${s.customer ? ' — ' + s.customer : ''} · ${[s.brand, s.appliance].filter(Boolean).join(' ')}${s.problem ? ' — ' + s.problem : ''} · area tech: ${s.tech ? s.tech.n : 'UNROUTED'} · ${s.at}  →  ${SITE}/teddy-tdr-tool.html?job_id=${s.job_id}`;
  const body = `${work.length} Teddy Tool diagnosis${work.length === 1 ? '' : 'es'} filed:\n\n` + work.map(lineFor).join('\n') + `\n\nBoard: ${SITE}/office-board.html`;
  const subject = `🔧 ${work.length} Teddy Tool diagnosis filed — TN Appliance`;
  let email = { ok: false };
  try {
    const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
      body: JSON.stringify({ to: TO, subject, body }), signal: AbortSignal.timeout(15000),
    });
    email = await r.json().catch(() => ({ ok: false }));
  } catch (e) { email = { ok: false, error: String(e.message || e) }; }

  // 3. record dedup (only after we acted)
  try { await crud.logEvent('tdr_submit_notified', { ids: work.map((s) => Number(s.id)), count: work.length, texted, email_mode: email && email.mode, at_ms: Date.now() }); } catch (_) {}

  out.texted = texted;
  out.email = email;
  out.summary = `${work.length} submission(s) · texts: ${texted.filter((t) => t.sms === 'sent').length} sent · email ${email && email.ok ? (email.mode || 'sent') : 'FAILED'}`;
  return json(200, out);
};
