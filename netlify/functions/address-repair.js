// address-repair — TARGETED address recovery. The reconcile pages the newest dispatches;
// this instead takes the FLAGGED jobs (no street / number-only street / no city / bad zip /
// broken name / no phone) and, for each, does a PRECISE Gmail lookup of that job's own
// dispatch ("New Dispatch Notification #<claim>"), reads the real XML, and patches the job.
// AHS sends full streets in the dispatch (verified: "744 JACE DR") — the job just never got
// updated. This closes that gap job-by-job so the crew can trust every address.
//
//   GET ?secret=<admin>[&offset=0][&batch=12][&days=180]   DRY  — show the match + patch
//   GET ?secret=<admin>&confirm=1                          LIVE — apply
// Loop by the returned next_offset until it is null.
'use strict';
exports.config = { timeout: 26 };
const { google } = require('googleapis');
const { parseServicePowerBody } = require('./_lib/parsers/servicepower');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const s = (v) => String(v == null ? '' : v).trim();
const digits = (v) => s(v).replace(/\D/g, '');
const titleCase = (v) => s(v).toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
const hasStreetName = (v) => { v = s(v); return !!v && /[a-z]{2,}/i.test(v.replace(/^\s*\d+[a-z]?\s*/i, '')); };

function findXml(payload) {
  if (!payload) return null;
  for (const p of (payload.parts || [])) {
    const fn = (p.filename || '').toLowerCase();
    if ((fn.endsWith('.xml') || (p.mimeType || '').includes('xml')) && p.body && p.body.attachmentId) return p.body.attachmentId;
    const n = findXml(p); if (n) return n;
  }
  return null;
}
const attr = (tag, a) => { const p = (String(tag).split(a + '="')[1] || ''); return (p.split('"')[0] || '').trim(); };
// ServicePower / SquareTrade / NSA emails carry the address in the text/plain body.
function findPlainBody(payload) {
  if (!payload) return '';
  if ((payload.mimeType || '') === 'text/plain' && payload.body && payload.body.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  for (const p of (payload.parts || [])) { const b = findPlainBody(p); if (b) return b; }
  return '';
}
function parseName(raw) {
  let n = s(raw); if (n.includes('&')) n = n.split('&')[0].trim();
  const t = n.replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!t.length) return { first: '', last: '' };
  if (t.length === 1) return { first: '', last: titleCase(t[0]) };
  return { first: titleCase(t[0]), last: t.slice(1).map(titleCase).join(' ') };
}
function parseDispatch(xml) {
  const cp = (xml.split('<CoveredProperty ')[1] || '').split('>')[0] || '';
  const street = [attr(cp, 'StreetNumber'), attr(cp, 'StreetDirection'), attr(cp, 'StreetName'), attr(cp, 'UnitType'), attr(cp, 'UnitNumber')].filter(Boolean).join(' ').trim();
  const cc = (xml.split('<ContractCustomer ')[1] || '').split('>')[0] || '';
  const dc = (xml.split('<DispatchContact ')[1] || '').split('</DispatchContact>')[0] || '';
  const phone = ((dc.match(/Number="(\d[\d\-() ]{6,})"/) || [])[1] || '');
  const nm = parseName(attr(cc, 'Name'));
  return {
    street: titleCase(street), city: titleCase(attr(cp, 'CityName')), state: attr(cp, 'StateCode').toUpperCase(),
    zip: digits(attr(cp, 'ZipPostCode')).slice(0, 5), first: nm.first, last: nm.last, phone: digits(phone).slice(-10),
  };
}
const ACTIVE = new Set(['not_ready', 'needs_scheduled', 'scheduled', 'in_progress', 'awaiting_parts', 'held', 'needs_more_info', 'broadcasting', 'booked']);
function addrBad(street) { return !hasStreetName(street); }

async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const live = q.confirm === '1';
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  const batch = Math.min(parseInt(q.batch, 10) || 12, 20);
  const days = Math.max(30, Math.min(365, parseInt(q.days, 10) || 180));

  // customers for the address fallback
  const custById = {};
  try { for (let pg = 1; pg <= 6; pg++) { const rows = await listPage(6, 500, pg); rows.forEach((c) => { custById[c.id] = c; }); if (rows.length < 500) break; } } catch (_) {}

  let jobs = [];
  try { for (let pg = 1; pg <= 8; pg++) { const rows = await listPage(7, 300, pg); jobs = jobs.concat(rows); if (rows.length < 300) break; } }
  catch (e) { return json(200, { ok: false, error: 'jobs: ' + String(e.message || e) }); }

  // Flagged = ADDRESS-recoverable via a dispatch: bad/absent street, or name broken, on a
  // real active job that has a dispatch/claim number to look up.
  const flagged = [];
  for (const j of jobs) {
    const ss = s(j.scheduling_status).toLowerCase(), cs = s(j.current_status).toLowerCase();
    if (!ACTIVE.has(ss) || /cancel/.test(cs)) continue;
    const cust = custById[j.customer_id] || {};
    const name = (s(j.customer_first || cust.first_name) + ' ' + s(j.customer_last || cust.last_name)).trim();
    const phone = digits(j.customer_phone || cust.phone);
    const appl = s(j.appliance_type || j.appliance);
    if (!name && phone.length < 10 && !appl) continue; // dead shell
    const jStreet = s(j.service_address), cStreet = s(cust.address);
    const streetBad = addrBad(jStreet) && addrBad(cStreet);
    const first = s(j.customer_first), last = s(j.customer_last);
    const nameBad = (!first && !last) || (first && last && first.toLowerCase() === last.toLowerCase()) || (!last && /\s/.test(first)) || (!first && last);
    const num = s(j.claim_number) || s(j.dispatch_source_id);
    if ((streetBad || nameBad) && num) flagged.push(j);
  }
  flagged.sort((a, b) => ((Number(b.technician_id) > 0 ? 1 : 0) - (Number(a.technician_id) > 0 ? 1 : 0)) || (b.id - a.id));

  const slice = flagged.slice(offset, offset + batch);
  const next_offset = (offset + batch < flagged.length) ? (offset + batch) : null;

  const cid = process.env.GMAIL_CLIENT_ID, csec = process.env.GMAIL_CLIENT_SECRET, rt = process.env.GMAIL_REFRESH_TOKEN;
  if (!cid || !csec || !rt) return json(500, { ok: false, error: 'gmail env missing' });
  const oauth2 = new google.auth.OAuth2(cid, csec); oauth2.setCredentials({ refresh_token: rt });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const plan = []; let fixed = 0, matched = 0, unmatched = 0; const fails = [];
  for (const j of slice) {
    const nums = [s(j.claim_number), s(j.dispatch_source_id)].filter(Boolean);
    let disp = null, hitNum = '';
    for (const num of nums) {
      try {
        const list = await gmail.users.messages.list({ userId: 'me', q: `subject:"New Dispatch Notification #${num}" newer_than:${days}d`, maxResults: 1 });
        const mid = ((list.data.messages || [])[0] || {}).id; if (!mid) continue;
        const m = await gmail.users.messages.get({ userId: 'me', id: mid, format: 'full' });
        const aid = findXml(m.data.payload); if (!aid) continue;
        const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: mid, id: aid });
        disp = parseDispatch(Buffer.from(a.data.data, 'base64url').toString('utf8')); hitNum = num; break;
      } catch (_) {}
    }
    // Fallback: ServicePower / SquareTrade / NSA dispatch — address is in the plaintext body.
    if (!disp) {
      for (const num of nums) {
        try {
          const list = await gmail.users.messages.list({ userId: 'me', q: `"${num}" newer_than:${days}d`, maxResults: 3 });
          for (const { id } of (list.data.messages || [])) {
            const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
            const body = findPlainBody(m.data.payload); if (!body || !/Call\s*#|SQUARE TRADE|Consumer Address/i.test(body)) continue;
            const parsed = parseServicePowerBody(body, 'Service Request Offer');
            const dd = (parsed.dispatches || []).find((x) => s(x.call_number) === num) || (parsed.dispatches || [])[0];
            if (dd && dd.customer && (dd.customer.raw_street || dd.customer.first_name)) {
              disp = { street: titleCase(dd.customer.raw_street), city: titleCase(dd.customer.raw_city), state: s(dd.customer.raw_state).toUpperCase(), zip: digits(dd.customer.raw_zip).slice(0, 5), first: titleCase(dd.customer.first_name), last: titleCase(dd.customer.last_name), phone: digits(dd.customer.phone10 || dd.customer.raw_phone).slice(-10) };
              hitNum = num; break;
            }
          }
          if (disp) break;
        } catch (_) {}
      }
    }
    if (!disp) { unmatched++; plan.push({ job: j.id, name: (s(j.customer_first) + ' ' + s(j.customer_last)).trim(), tech: Number(j.technician_id || 0), claim: nums[0], result: 'no_dispatch_found' }); continue; }
    matched++;
    const patch = {};
    if (disp.street && hasStreetName(disp.street) && !hasStreetName(s(j.service_address))) patch.service_address = disp.street;
    if (disp.city && !s(j.service_city)) patch.service_city = disp.city;
    if (disp.state && !s(j.service_state)) patch.service_state = disp.state;
    if (disp.zip && digits(j.service_zip).length !== 5) patch.service_zip = disp.zip;
    const jf = s(j.customer_first), jl = s(j.customer_last);
    const nameBad = (!jf && !jl) || (jf && jl && jf.toLowerCase() === jl.toLowerCase()) || (!jl && /\s/.test(jf)) || (!jf && jl);
    if (nameBad && (disp.first || disp.last)) { patch.customer_first = disp.first; patch.customer_last = disp.last; }
    if (disp.phone && disp.phone.length === 10 && digits(j.customer_phone).length < 10) patch.customer_phone = '+1' + disp.phone;

    if (!Object.keys(patch).length) { plan.push({ job: j.id, claim: hitNum, result: 'already_correct', dispatch_street: disp.street }); continue; }
    plan.push({ job: j.id, claim: hitNum, tech: Number(j.technician_id || 0), was_street: s(j.service_address), patch });
    if (live) {
      try { const r = await fetch(`${META}/table/7/content/${j.id}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) }); if (r.ok) { fixed++; await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'address_repaired_from_dispatch', metadata: { job_id: j.id, patch, at_ms: Date.now() } }) }).catch(() => {}); } else fails.push({ job: j.id, status: r.status }); } catch (e) { fails.push({ job: j.id, err: String(e.message || e) }); }
    }
  }
  return json(200, { ok: true, mode: live ? 'LIVE' : 'DRY', total_flagged: flagged.length, offset, batch, next_offset, in_batch: slice.length, matched, unmatched, fixed: live ? fixed : 0, failed: fails.length, plan });
};
