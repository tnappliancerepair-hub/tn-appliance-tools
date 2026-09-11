// platform-job-prep — make sure the tech knows the machine BEFORE the truck rolls.
//
// WHY. Measured 2026-09-11 across TN's 44 upcoming scheduled jobs:
//
//   problem described ... 100%
//   MODEL NUMBER ........  57%   <- 43% of the time he does not know the machine
//   photo / video .......  32%
//   parts on the job ....  34%
//
// The model number is not one field among many. It is THE input: it decides the part, and
// the part decides whether this is one trip or two. The crew's first-visit-fix sits at
// 86-89% -- they are good -- so the way to help them is not coaching, it is not sending
// them out blind.
//
// And the model is already sitting in the vendor's API, paid for. Checked live: 19 of 19
// SquareTrade dispatches came back carrying one (WDT730HAMZ, LRFXC2606S, WRF757SDHZ...).
// It just was never written onto the unit the tech reads.
//
// FILL BLANKS ONLY. It never overwrites a model somebody already knows -- same rule the
// mirror follows, and for the same reason: a confident wrong model sends a tech out with
// the wrong part, which is worse than sending him out with none.
//
//   GET ?secret=<admin>&dry=1        what it WOULD fill (default: dry)
//   GET ?secret=<admin>&live=1       fill them
//   GET ?secret=<admin>&company=<id> another tenant (defaults to the caller's own vendor creds)
//   GET ?secret=<admin>&days=N       how far ahead to look (default 21)
'use strict';

const spTenant = require('./_lib/servicepower-tenant');
const { getSecret } = require('./_lib/secrets');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const S = (v) => (v == null ? '' : String(v).trim());

// ServicePower fills empty fields with "0" and other placeholders. A placeholder written
// onto a unit reads as a real model to the tech, which is the failure this exists to prevent.
function realModel(v) {
  const m = S(v).toUpperCase();
  if (m.length < 3) return '';
  if (/^(0+|N\/?A|NONE|NULL|UNKNOWN|TBD|-+)$/.test(m)) return '';
  // A real appliance model always carries a digit. Without this, ServicePower's product
  // description ("Refrigerator") lands on the unit AS the model and sends a tech hunting a
  // part for a word. Caught in testing; it is the whole reason this guard exists.
  if (!/[0-9]/.test(m)) return '';
  return m;
}

async function sget(base, H, path) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(10000) });
  return r.ok ? (await r.json().catch(() => [])) : [];
}
async function spatch(base, H, path, body) {
  const r = await fetch(`${base}/rest/v1/${path}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  return r.ok;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // Dry unless explicitly told otherwise. This writes to job data a tech reads.
  const dry = !(q.live === '1' || q.live === 'true');
  const companyId = S(q.company) || TN_COMPANY;
  const days = Math.max(1, Math.min(90, Number(q.days) || 21));
  const limit = Math.max(1, Math.min(200, Number(q.limit) || 60));

  const url = S(await getSecret('PLATFORM_SUPABASE_URL')).replace(/\/+$/, '');
  const key = S(await getSecret('PLATFORM_SUPABASE_SERVICE_KEY'));
  if (!url || !key) return json(200, { ok: false, error: 'platform not configured' });
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  const bound = await spTenant.forCompany(companyId).catch(() => null);
  if (!bound) return json(200, { ok: false, error: 'no ServicePower credentials for this company' });

  // Upcoming work only. Backfilling a model onto a job nobody is driving to helps no one.
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const jobs = await sget(url, H,
    `job?company_id=eq.${companyId}&status=in.(new,scheduled)&claim_number=not.is.null&claim_number=neq.` +
    `&scheduled_day=lte.${until}&select=id,unit_id,claim_number,scheduled_day,warranty_company&limit=${limit}`);
  if (!jobs.length) return json(200, { ok: true, mode: dry ? 'dry' : 'live', looked_at: 0, note: 'no upcoming jobs with a dispatch number' });

  // Which of those units are actually missing a model?
  const unitIds = [...new Set(jobs.map((j) => j.unit_id).filter(Boolean))];
  const units = {};
  for (let i = 0; i < unitIds.length; i += 100) {
    for (const u of await sget(url, H, `unit?id=in.(${unitIds.slice(i, i + 100).join(',')})&select=id,label,attributes&limit=200`)) units[u.id] = u;
  }
  const needy = jobs.filter((j) => {
    const u = units[j.unit_id]; if (!u) return false;
    return !realModel((u.attributes || {}).model);
  });

  const filled = [], missing = [], failed = [];
  for (const j of needy.slice(0, limit)) {
    let call = null;
    try {
      // One dispatch, one read. getCallInfo takes the call number we already hold.
      const res = await bound.getCallInfo({ callNumber: S(j.claim_number) });
      const calls = (res && (res.calls || res)) || [];
      call = Array.isArray(calls) ? calls.find((c) => realModel(c && c.model)) || calls[0] : null;
    } catch (e) { failed.push({ job: j.id, call: j.claim_number, err: String((e && e.message) || e).slice(0, 90) }); continue; }

    const model = realModel(call && call.model);
    if (!model) { missing.push({ job: j.id, call: j.claim_number, day: j.scheduled_day }); continue; }
    const serial = S(call && call.serial).toUpperCase();
    const brand = S(call && call.brand);

    const u = units[j.unit_id] || {};
    const attrs = Object.assign({}, u.attributes || {});
    attrs.model = model;
    // Only ever ADD. A serial or brand somebody already recorded stays put.
    if (serial && serial !== '0' && !S(attrs.serial)) attrs.serial = serial;
    if (brand && !S(attrs.brand)) attrs.brand = brand;

    if (!dry) {
      const ok = await spatch(url, H, `unit?id=eq.${j.unit_id}`, { attributes: attrs });
      if (!ok) { failed.push({ job: j.id, call: j.claim_number, err: 'unit patch refused' }); continue; }
    }
    filled.push({ job: j.id, call: j.claim_number, day: j.scheduled_day, model, serial: attrs.serial || '', brand: attrs.brand || '' });
  }

  return json(200, {
    ok: true, mode: dry ? 'dry' : 'live', company_id: companyId,
    upcoming_with_dispatch: jobs.length,
    missing_a_model: needy.length,
    filled: filled.length,
    vendor_had_none: missing.length,
    failed: failed.length,
    filled_list: filled.slice(0, 40),
    vendor_had_none_list: missing.slice(0, 10),
    failed_list: failed.slice(0, 5),
  });
};
