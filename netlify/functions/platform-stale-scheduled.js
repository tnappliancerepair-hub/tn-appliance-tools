// platform-stale-scheduled — the office's pass over jobs stuck at `scheduled` on a day that
// already went by.
//
// Measured 2026-09-10: 331 of them, oldest 2026-06-02. Xano agrees on every one, so this is
// real work in limbo, not mirror drift. The job says scheduled; the schedule shows today
// forward; both are honest and nobody can see the gap. Whether each one is done-but-never-marked
// or never-done is a human call - this makes that call fast, it does not make it for anyone.
//
// WHY IT WRITES TO XANO: platform `status` is derived from Xano on every 5-minute mirror run,
// so fixing it here alone would be undone before the office finished scrolling.
//
// THE TEXT LANDMINE, defused before this shipped: office_set_job_status -> completed is a
// TRANSITION, and job-completion-watch picks up any transition inside a 36h window and emits
// job_completed, which review-request-sweep feeds on. Clearing this backlog would have texted
// hundreds of customers "how'd we do?" about a visit from June. The guard lives in
// _lib/review-ask (work older than 10 days is never asked about) because a stale ask is wrong
// however the completion got there.
//
//   POST ?do=list     { access_token, days? }          -> { ok, jobs:[…], recent, older }
//       days defaults to 21. Teddy 2026-09-10: "three weeks is really as far back as we need to
//       go... those would be the ones I would focus on, not the ones before that." So the page
//       LEADS with the recent ones and parks the rest behind a tap. Everything is still returned
//       and still counted — nothing is hidden from the office, it just stops being the wall you
//       hit before you can start.
//   POST ?do=resolve  { access_token, job, action }     action = completed | reopen | cancel
'use strict';

const { getSecret } = require('./_lib/secrets');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const json = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b) });
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

async function cfg() {
  return {
    url: String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, ''),
    key: (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '',
  };
}
async function authUser(base, key, tok) {
  if (!tok) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; const u = await r.json(); return (u && u.id) ? u : null;
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const doo = String(p.do || 'list');

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const get = async (path) => {
    try { const r = await fetch(`${url}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(12000) }); return r.ok ? r.json() : []; } catch (_) { return []; }
  };
  // PostgREST caps a response at 1,000 rows whatever `limit` asks for, silently. 331 today, but
  // shipping a new query that quietly goes short the moment the backlog grows is the exact bug
  // this whole day was spent finding. Page it.
  const getAll = async (path) => {
    const rows = [];
    for (let from = 0; from < 20000; from += 1000) {
      let got = [];
      try {
        const r = await fetch(`${url}/rest/v1/${path}`, {
          headers: Object.assign({ Range: `${from}-${from + 999}` }, H), signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) break;
        got = await r.json().catch(() => []);
      } catch (_) { break; }
      if (!Array.isArray(got) || !got.length) break;
      rows.push.apply(rows, got);
      if (got.length < 1000) break;
    }
    return rows;
  };

  const u = await authUser(url, key, String(p.access_token || '').trim());
  if (!u) return json(401, { ok: false, error: 'not_signed_in' });
  const me = (await get(`app_user?auth_user_id=eq.${u.id}&select=company_id,name,role&limit=1`))[0];
  const companyId = me && me.company_id;
  if (!companyId) return json(403, { ok: false, error: 'no_company' });
  // Office work, not a tech's. The board and this queue answer to the same seats.
  if (['owner', 'office', 'manager', 'admin'].indexOf(String(me.role || '')) === -1) {
    return json(403, { ok: false, error: 'office_only' });
  }

  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  if (doo === 'list') {
    // Three weeks is the working horizon. Older work still comes back, flagged, so the office
    // can go find it - it just isn't what the page opens on.
    const WINDOW = Math.max(1, Math.min(365, Number(p.days || 21)));
    const sel = 'id,xano_id,scheduled_day,technician_id,problem,parts_status,tdr_diagnosis,tdr_failed_component,tdr_repair_completed,' +
                'customer:customer_id(first_name,last_name,phone,city),unit:unit_id(label)';
    // Every one of these fits well inside a single page (331 today), but ask in order so the
    // oldest - the ones most likely already done and forgotten - come first.
    const jobs = await getAll(`job?company_id=eq.${companyId}&status=eq.scheduled&scheduled_day=lt.${today}&select=${sel}&order=scheduled_day.asc,id.asc`);
    const techs = await get(`technician?company_id=eq.${companyId}&select=id,name,active`);
    const nm = {}; (techs || []).forEach((t) => { nm[t.id] = t.name; });
    const out = (Array.isArray(jobs) ? jobs : []).map((r) => {
      const c = r.customer || {};
      const days = Math.round((Date.parse(today) - Date.parse(r.scheduled_day)) / 86400000);
      const hasReport = !!(String(r.tdr_diagnosis || '').trim() || String(r.tdr_failed_component || '').trim() || String(r.tdr_repair_completed || '').trim());
      const partsPending = /await|order/i.test(String(r.parts_status || ''));
      return {
        id: r.id, xano_id: r.xano_id, day: r.scheduled_day, days_ago: days, recent: days <= WINDOW,
        tech: nm[r.technician_id] || '', tech_id: r.technician_id,
        customer: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '(no name)',
        city: c.city || '', phone: c.phone || '',
        appliance: (r.unit && r.unit.label) || '', problem: String(r.problem || '').slice(0, 140),
        has_report: hasReport, parts_pending: partsPending,
      };
    });
    const recent = out.filter((x) => x.recent).length;
    return json(200, { ok: true, today, window_days: WINDOW, count: out.length, recent, older: out.length - recent, jobs: out });
  }

  if (doo === 'resolve') {
    const jobId = String(p.job || '').trim();
    const action = String(p.action || '').trim();
    if (!jobId || ['completed', 'reopen', 'cancel'].indexOf(action) === -1) return json(400, { ok: false, error: 'need job + action' });

    const row = (await get(`job?id=eq.${jobId}&company_id=eq.${companyId}&select=id,xano_id,status&limit=1`))[0];
    if (!row) return json(404, { ok: false, error: 'not_found' });
    // A job with NO xano_id was born on the platform and does not exist in Xano - there is
    // nothing to push and nothing to keep in step, so it resolves here and stops. This is not an
    // edge case for long: every job the platform takes over intake for lands this way, and
    // refusing them (the first cut returned no_xano_id) would have made the tool useless exactly
    // as the migration succeeds. Surfaced by the 9/8 practice job, which is platform-native.
    const xid = Number(row.xano_id || 0);
    const platformOnly = !xid;

    const patchPlatform = async (fields) => {
      const r = await fetch(`${url}/rest/v1/job?id=eq.${jobId}&company_id=eq.${companyId}`, {
        method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, H),
        body: JSON.stringify(fields), signal: AbortSignal.timeout(12000),
      });
      return r.ok;
    };

    const callXano = async (path, payload) => {
      const r = await fetch(`${XANO}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      const d = await r.json().catch(() => null);
      return { ok: r.ok, data: d };
    };

    if (platformOnly) {
      const fields = action === 'completed' ? { status: 'completed', completed_at: new Date().toISOString() }
                   : action === 'cancel'    ? { status: 'canceled' }
                   : { scheduled_day: null, scheduled_start: null, status: 'new' };
      if (!(await patchPlatform(fields))) return json(500, { ok: false, error: 'platform_write_failed' });
      return json(200, { ok: true, action, job: jobId, platform_only: true });
    }

    if (action === 'reopen') {
      // Hand it to the booking pusher rather than writing the schedule twice. Clearing the day
      // on the platform + stamping the queue is exactly what an office unschedule does, and the
      // pusher already knows how to make Xano agree (scheduled_start null, status not_ready).
      const r = await fetch(`${url}/rest/v1/job?id=eq.${jobId}&company_id=eq.${companyId}`, {
        method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, H),
        body: JSON.stringify({ scheduled_day: null, scheduled_start: null, status: 'new', platform_booked_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return json(500, { ok: false, error: 'platform_write_failed' });
      let push = null;
      try { push = await require('./platform-tn-booking-back').runBookingBack({ max: '60' }); } catch (_) {}
      return json(200, { ok: true, action, job: jobId, xano_id: xid, pushed: !!(push && push.pushed) });
    }

    if (action === 'completed') {
      const res = await callXano('office_set_job_status', { job_id: xid, scheduling_status: 'completed' });
      if (!res.ok) return json(502, { ok: false, error: 'xano_write_failed', detail: res.data });
      return json(200, { ok: true, action, job: jobId, xano_id: xid, xano: res.data });
    }

    // cancel — office_remove_job is the board's own soft-remove: reversible, audited, and it
    // does not text the customer.
    const res = await callXano('office_remove_job', { job_id: xid, action: 'delete' });
    if (!res.ok) return json(502, { ok: false, error: 'xano_write_failed', detail: res.data });
    return json(200, { ok: true, action, job: jobId, xano_id: xid, xano: res.data });
  }

  return json(400, { ok: false, error: 'unknown do=' + doo });
};
