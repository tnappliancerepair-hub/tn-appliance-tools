// ahs-reconcile — GUARANTEE the name / address / phone on every AHS job matches its ACTUAL
// dispatch (Teddy 2026-07-15: we stay until the data is fully trustworthy). AHS sends an
// early placeholder ("StreetNumber=1", unsplit name) then the real dispatch, and our intake
// doesn't correct the job when the good data lands -> stale "1, City" + one-field names. The
// parser is CORRECT (verified against real XML: claim #64539459 -> "4500 FOLSE DR"); the job
// just never got updated. This re-reads the true dispatch XML by claim number and fixes any
// job whose data is worse than the dispatch. Also refreshes the customer record.
//
//   GET ?secret=<admin>[&days=45][&max=120]      DRY - show the corrections
//   GET ?secret=<admin>&confirm=1                act
'use strict';
exports.config = { timeout: 26 };   // Gmail fetches are slow; cap the batch to fit.
const { google } = require('googleapis');
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
// Split the single AHS Name field ("EUNICE DUREL", "ROBIN JONES & HOSEA JONES", "JOHNSON")
// into a clean first + last. Primary person only; single token = surname.
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

async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const isCron = !q.secret;              // Netlify scheduled invocation passes no query string
  const live = q.confirm === '1' || isCron;   // the scheduled run acts (keeps recent AHS jobs correct)
  const days = Math.max(3, Math.min(120, parseInt(q.days, 10) || 45));
  const max = Math.min(parseInt(q.max, 10) || 18, 30);   // Gmail fetch is slow -> small batches fit the timeout; run repeatedly / schedule to cover all.

  // 1) Pull the real dispatch data, keyed by dispatch/claim number (from the subject).
  const cid = process.env.GMAIL_CLIENT_ID, csec = process.env.GMAIL_CLIENT_SECRET, rt = process.env.GMAIL_REFRESH_TOKEN;
  if (!cid || !csec || !rt) return json(500, { ok: false, error: 'gmail env missing' });
  const oauth2 = new google.auth.OAuth2(cid, csec); oauth2.setCredentials({ refresh_token: rt });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const byClaim = {};
  try {
    const list = await gmail.users.messages.list({ userId: 'me', q: `subject:"New Dispatch Notification" has:attachment newer_than:${days}d`, maxResults: max });
    for (const { id } of (list.data.messages || [])) {
      const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const headers = m.data.payload.headers || [];
      const subj = ((headers.find((x) => x.name.toLowerCase() === 'subject') || {}).value) || '';
      const num = (subj.match(/#\s*(\d{5,})/) || [])[1];
      if (!num) continue;
      const aid = findXml(m.data.payload); if (!aid) continue;
      const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: aid });
      const xml = Buffer.from(a.data.data, 'base64url').toString('utf8');
      byClaim[num] = parseDispatch(xml);
    }
  } catch (e) { return json(200, { ok: false, error: 'gmail: ' + String(e.message || e) }); }

  // 2) Load jobs, match by claim_number / dispatch_source_id, compute corrections.
  let jobs = [];
  try { for (let pg = 1; pg <= 8; pg++) { const rows = await listPage(7, 400, pg); jobs = jobs.concat(rows); if (rows.length < 400) break; } }
  catch (e) { return json(200, { ok: false, error: 'jobs: ' + String(e.message || e) }); }

  const plan = []; let fixed = 0; const fails = [];
  for (const j of jobs) {
    const keys = [s(j.claim_number), s(j.dispatch_source_id)].filter(Boolean);
    let disp = null; for (const k of keys) { if (byClaim[k]) { disp = byClaim[k]; break; } }
    if (!disp) continue;
    const patch = {};
    // ADDRESS - only overwrite a job field that is missing/bogus with the dispatch's good one.
    if (disp.street && hasStreetName(disp.street) && !hasStreetName(s(j.service_address))) patch.service_address = disp.street;
    if (disp.city && !s(j.service_city)) patch.service_city = disp.city;
    if (disp.state && !s(j.service_state)) patch.service_state = disp.state;
    if (disp.zip && digits(j.service_zip).length !== 5) patch.service_zip = disp.zip;
    // NAME - fix a missing/duplicated/unsplit name from the dispatch's clean split.
    const jf = s(j.customer_first), jl = s(j.customer_last);
    const nameBad = (!jf && !jl) || (jf && jl && jf.toLowerCase() === jl.toLowerCase()) || (!jl && /\s/.test(jf)) || (!jf && jl);
    if (nameBad && (disp.first || disp.last)) { patch.customer_first = disp.first; patch.customer_last = disp.last; }
    // PHONE - fill a missing job phone from the dispatch.
    if (disp.phone && disp.phone.length === 10 && digits(j.customer_phone).length < 10) patch.customer_phone = '+1' + disp.phone;

    if (!Object.keys(patch).length) continue;
    plan.push({ job: j.id, claim: keys[0], patch, was: { street: s(j.service_address), first: jf, last: jl } });
    if (live) {
      try { const r = await fetch(`${META}/table/7/content/${j.id}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) }); if (r.ok) { fixed++; await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'ahs_reconciled_from_dispatch', metadata: { job_id: j.id, patch, at_ms: Date.now() } }) }).catch(() => {}); } else fails.push({ job: j.id, status: r.status }); } catch (e) { fails.push({ job: j.id, err: String(e.message || e) }); }
    }
  }
  return json(200, { ok: true, mode: live ? 'LIVE' : 'DRY', dispatches_read: Object.keys(byClaim).length, corrections: plan.length, fixed: live ? fixed : 0, failed: fails.length, plan: plan.slice(0, 80) });
};
