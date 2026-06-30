// tech-tool-dispatch — send the LOADED Teddy Tool link to the tech who's going to
// service each machine. Teddy's rule: the techs get ONE meaningful text per job —
// their job's Teddy Tool (diagnosis + photos/video + parts + recalls), and nothing
// else, so they keep checking their texts. This is the single channel.
//
// Pulls upcoming SCHEDULED jobs that have an assigned tech, groups by tech, tracks
// which already got their link (dedup), and fires from the TECH line (857-8800) so
// a reply lands in the tech brain.
//
// GET  ?secret=<admin>|?password=<office>&days=2   -> upcoming assigned jobs by tech
// POST { action, job_id|ids, password|secret }
//   action=send        -> text the assigned tech this job's Teddy Tool link
//   action=send_bulk { ids:[...] } -> one tap, every listed job
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TELNYX = 'https://api.telnyx.com/v2';
const TECH_FROM = '+16158578800';
const JOBS = 7, DAY = 86400000;
// Active roster + known-good cells (Andre = 504, per technicians.phone). Billy (5) left.
const ROSTER = {
  1: { name: 'Teddy', phone: '+16154855795' },
  2: { name: 'Jimmy', phone: '+16159671304' },
  3: { name: 'Andre', phone: '+15049099413' },
  4: { name: 'Lee', phone: '+16158291654' },
  6: { name: 'John', phone: '+18133527686' },
};
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function ms(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v > 1e12 ? v : v * 1000; const t = Date.parse(v); return isNaN(t) ? 0 : t; }
function ctDay(x) { if (!x) return ''; const p = {}; for (const o of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(new Date(x))) p[o.type] = o.value; return `${p.weekday} ${p.month} ${p.day}`; }
async function officeOk(pw) { if (!pw) return false; try { const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }); const d = await r.json(); return !!(d && d.success === true); } catch (_) { return false; } }

async function techPhones() {
  // Prefer live technicians table, fall back to the known-good roster cells.
  const out = {};
  try {
    const rows = await crud.searchPage(crud.TABLES.technicians, {}, { id: 'asc' }, 50);
    for (const t of rows) {
      const id = Number(t.id);
      const phone = String(t.phone || '').replace(/[^\d]/g, '');
      const e164 = phone.length >= 10 ? ('+1' + phone.slice(-10)) : '';
      if (ROSTER[id]) out[id] = { name: ROSTER[id].name, phone: e164 || ROSTER[id].phone };
    }
  } catch (_) {}
  for (const id of Object.keys(ROSTER)) if (!out[id]) out[id] = { ...ROSTER[id] };
  return out;
}

async function sendOne(job, phones, teLnyxKey) {
  const techId = Number(job.technician_id);
  const t = phones[techId];
  if (!t || !t.phone) return { ok: false, error: 'no_tech_phone' };
  const link = `${SITE}/teddy-tdr-tool.html?job_id=${job.id}`;
  let cust = '(customer)';
  try { const c = await crud.searchOne(crud.TABLES.customer, { id: Number(job.customer_id) }); if (c) cust = [c.first_name, c.last_name].filter(Boolean).join(' ') || cust; } catch (_) {}
  const appl = [job.brand, job.appliance_type].filter(Boolean).join(' ') || 'the appliance';
  const city = job.service_city || '';
  const text = `${t.name} — your job: ${cust}${city ? ', ' + city : ''} (${appl}). Everything you need is right here — diagnosis, photos/video, parts & recalls, all in one place. Open your Teddy Tool: ${link}`;
  try {
    const r = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + teLnyxKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: TECH_FROM, to: t.phone, text }), signal: AbortSignal.timeout(12000) });
    const sd = await r.json().catch(() => ({}));
    if (r.ok) {
      await crud.logEvent('tech_tool_link_sent', { job_id: job.id, technician_id: techId, tech: t.name, to: t.phone, link });
      return { ok: true, to: t.phone, id: (sd.data && sd.data.id) || null };
    }
    return { ok: false, error: JSON.stringify(sd.errors || sd).slice(0, 200) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const ok = q.secret === admin || body.secret === admin || (await officeOk(q.password || body.password));
  if (!ok) return j(401, { ok: false, error: 'unauthorized' });

  if (event.httpMethod === 'POST') {
    const key = await getSecret('TELNYX_API_KEY');
    if (!key) return j(200, { ok: false, error: 'TELNYX_API_KEY not in vault' });
    const phones = await techPhones();
    const loadJob = async (id) => { try { const r = await crud.searchOne(JOBS, { id: Number(id) }); return r; } catch (_) { return null; } };
    try {
      if (body.action === 'send') {
        const jb = await loadJob(body.job_id);
        if (!jb) return j(200, { ok: false, error: 'job_not_found' });
        const r = await sendOne(jb, phones, key);
        return j(200, { ok: r.ok, job_id: jb.id, result: r });
      }
      if (body.action === 'send_bulk') {
        const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => parseInt(x, 10)).filter(Boolean);
        const out = [];
        for (const id of ids) { const jb = await loadJob(id); if (!jb) { out.push({ job_id: id, ok: false, error: 'not_found' }); continue; } const r = await sendOne(jb, phones, key); out.push({ job_id: id, ok: r.ok, error: r.error || null }); }
        return j(200, { ok: true, sent: out.filter((x) => x.ok).length, results: out });
      }
      return j(400, { ok: false, error: 'unknown action' });
    } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  }

  // ── LIST: upcoming assigned jobs ──────────────────────────────────────
  const days = Math.max(1, Math.min(7, parseInt(q.days, 10) || 2));
  const now = Date.now();
  const lo = now - 12 * 3600000;            // include earlier-today stops
  const hi = now + days * DAY;
  let scheduled = [];
  try { scheduled = await crud.searchPage(JOBS, { scheduling_status: 'scheduled' }, { scheduled_start: 'desc' }, 250); } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }

  // dedup: who already got their link
  const sentMap = new Map();
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'tech_tool_link_sent' }, { created_at: 'desc' }, 400);
    for (const r of rows) { let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } if (m && m.job_id != null && !sentMap.has(m.job_id)) sentMap.set(m.job_id, ms(r.created_at) || ms(r.created_at)); }
  } catch (_) {}

  const upcoming = scheduled.filter((jb) => {
    const tid = Number(jb.technician_id);
    if (!ROSTER[tid]) return false;
    const s = ms(jb.scheduled_start);
    return s >= lo && s <= hi;
  });

  // join customer names
  const custIds = [...new Set(upcoming.map((x) => x.customer_id).filter(Boolean))];
  const cmap = new Map();
  await Promise.all(custIds.map((cid) => crud.searchOne(crud.TABLES.customer, { id: cid }).then((c) => { if (c) cmap.set(cid, c); }).catch(() => {})));

  const byTech = {};
  for (const jb of upcoming) {
    const tid = Number(jb.technician_id);
    const c = cmap.get(jb.customer_id) || {};
    (byTech[tid] = byTech[tid] || { tech_id: tid, tech: ROSTER[tid].name, jobs: [] }).jobs.push({
      job_id: jb.id,
      customer: [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)',
      appliance: [jb.brand, jb.appliance_type].filter(Boolean).join(' ') || '',
      city: jb.service_city || '',
      day: ctDay(ms(jb.scheduled_start)),
      sched_ms: ms(jb.scheduled_start),
      warranty: jb.warranty_company || (String(jb.customer_type || '').toLowerCase() === 'self_pay' ? 'cash' : ''),
      already_sent: sentMap.has(jb.id),
    });
  }
  const groups = Object.values(byTech).map((g) => { g.jobs.sort((a, b) => a.sched_ms - b.sched_ms); g.unsent = g.jobs.filter((x) => !x.already_sent).length; return g; }).sort((a, b) => a.tech.localeCompare(b.tech));

  return j(200, {
    ok: true, window_days: days,
    total_jobs: upcoming.length,
    unsent: upcoming.filter((x) => !sentMap.has(x.id)).length,
    note: 'Each tech gets ONE text per job: their loaded Teddy Tool link. "Already sent" = link delivered.',
    groups,
  });
};
