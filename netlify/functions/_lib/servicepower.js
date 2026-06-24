// servicepower.js — connector for the ServicePower Servicer API (SOAP/SPDService).
// Push work-order status + notes for our SquareTrade/NSA dispatches → kills manual
// portal entry. No approval gate (unlike Frontdoor) — uses servicer credentials.
//
// Auth: credentials ride INSIDE each request as <UserInfo>{UserID,Password,SvcrAcct}</UserInfo>.
// Vault (getSecret, env-first then Xano):
//   SERVICEPOWER_USER_ID    - servicer UserID (HUB login or dedicated API user — confirm via v2.8 guide)
//   SERVICEPOWER_PASSWORD   - servicer password
//   SERVICEPOWER_SVCR_ACCT  - servicer account (TN Appliance = TNA00001)
//   SERVICEPOWER_ENV        - 'production' (default) | 'development'
//
// Service: urn:SPDServicerService, document/literal SOAP 1.1.
//   prod: https://fss.servicepower.com/sms/services/SPDService
//   dev:  https://fssstag.servicepower.com/sms/services/SPDService
// Spec: docs/servicepower-api-spec-2026-06-24.md
'use strict';

const { getSecret, getSecretFresh } = require('./secrets');

const NS = 'urn:SPDServicerService';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function serviceUrl() {
  const env = ((await getSecretFresh('SERVICEPOWER_ENV')) || 'production').toLowerCase();
  return env === 'development'
    ? 'https://fssstag.servicepower.com/sms/services/SPDService'
    : 'https://fss.servicepower.com/sms/services/SPDService';
}

async function isConfigured() {
  const [u, p, a] = await Promise.all([
    getSecret('SERVICEPOWER_USER_ID'), getSecret('SERVICEPOWER_PASSWORD'), getSecret('SERVICEPOWER_SVCR_ACCT'),
  ]);
  return !!(u && p && a);
}

async function userInfoXml() {
  const u = String(await getSecretFresh('SERVICEPOWER_USER_ID') || '').trim();
  const p = String(await getSecretFresh('SERVICEPOWER_PASSWORD') || '').trim();
  const a = String(await getSecretFresh('SERVICEPOWER_SVCR_ACCT') || '').trim();
  if (!u || !p || !a) throw new Error('ServicePower creds not in vault (SERVICEPOWER_USER_ID / _PASSWORD / _SVCR_ACCT)');
  // elementFormDefault="unqualified" — inner elements are NOT namespace-prefixed.
  return `<UserInfo><UserID>${esc(u)}</UserID><Password>${esc(p)}</Password><SvcrAcct>${esc(a)}</SvcrAcct></UserInfo>`;
}

// Generic SOAP call: wraps innerXml in the envelope, POSTs, returns raw + a few parsed fields.
async function soapCall(innerXml, soapAction) {
  const url = await serviceUrl();
  const body = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="${NS}">`
    + `<soap:Body>${innerXml}</soap:Body></soap:Envelope>`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction || '""' },
    body, signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  const pick = (tag) => { const m = text.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)</[^>]*${tag}>`, 'i')); return m ? m[1].trim() : null; };
  const fault = /<(soap:)?Fault>/i.test(text);
  const errOccurred = pick('erroroccurred');
  return {
    ok: r.ok && !fault && String(errOccurred || '').toUpperCase() !== 'Y',
    status: r.status,
    fault,
    error_occurred: errOccurred,
    ack: pick('ackmessage'),
    err_code: pick('Code'),          // errordata.Code — the REAL reason
    err_desc: pick('Description'),    // errordata.Description
    err_cause: pick('Cause'),        // errordata.Cause
    fault_string: pick('faultstring'),
    raw: text,
  };
}

// Connectivity/health check (string in → string out). Good first call after vaulting creds.
async function getTestService(msg) {
  const inner = `<impl:getTestService><impl:arg0>${esc(msg || 'ping')}</impl:arg0></impl:getTestService>`;
  return soapCall(inner, '');
}

// Push a work-order status update (+ optional note). The status-code values
// (SPCallStatusID) come from the Dispatch Web Service Interface v2.8 guide — map our
// lifecycle to those once we have it. Fields beyond callNumber/status/notes are optional.
async function updateCallInfo({ callNumber, mfgId, fssCallId, scheduleDate, scheduleTimePeriod, problemDesc, callStatus, spCallStatusId, callSubStatus, spCallSubStatusId, notes, notesDate, addedBy, eta, etf, completedDate }) {
  const ui = await userInfoXml();
  const f = (tag, v) => (v == null || v === '' ? '' : `<${tag}>${esc(v)}</${tag}>`);   // unqualified children
  let remarks = '';
  if (notes) {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;  // ServicePower wants YYYYMMDD
    remarks = `<Remarks>${f('NotesDate', notesDate || ymd)}<Notes>${esc(notes)}</Notes>${f('AddedBy', addedBy || 'Ant')}</Remarks>`;
  }
  const inner = `<impl:updateCallInfoObj>${ui}`
    + f('CallNumber', callNumber) + f('MfgId', mfgId) + f('FSSCallId', fssCallId)
    + f('ScheduleDate', scheduleDate) + f('ScheduleTimePeriod', scheduleTimePeriod)
    + f('ProbelmDesc', problemDesc)   // NOTE: their API spells it "Probelm" — keep as-is
    + f('CallStatus', callStatus) + f('SPCallStatusID', spCallStatusId)
    + f('CallSubStatus', callSubStatus) + f('SPCallSubStatusID', spCallSubStatusId)
    + remarks + f('ETA', eta) + f('ETF', etf) + f('CompletedDate', completedDate)
    + `</impl:updateCallInfoObj>`;
  return soapCall(inner, '');
}

// Poll for jobs / read a call's current status (validates creds + reveals live
// SPCallStatusID values). Request: getCallInfoSearch{ UserInfo, FromDateTime, ToDateTime, Callno }.
// Dates: "mm/dd/yyyy HH:mm:ss". Response CallInfo includes CallStatus + SPCallStatusID.
async function getCallInfo({ fromDateTime, toDateTime, callNo }) {
  const ui = await userInfoXml();
  const f = (tag, v) => (v == null || v === '' ? '' : `<${tag}>${esc(v)}</${tag}>`);   // unqualified children
  const inner = `<impl:getCallInfoSearch>${ui}`
    + f('FromDateTime', fromDateTime) + f('ToDateTime', toDateTime) + f('Callno', callNo)
    + `</impl:getCallInfoSearch>`;
  const r = await soapCall(inner, '');
  r.calls = parseCalls(r.raw || '');
  r.call_statuses_seen = [...new Set(r.calls.map((c) => c.status).filter(Boolean))];
  return r;
}

// MAIN CallStatus vocabulary (from v2.8 §7.4): OPEN, ACCEPTED, COMPLETED, REJECTED,
// RESCHEDULED, CANCELED, CLAIMED. Sub-statuses (SPCallSubStatusID) are per servicer/client (§13.4).
const CALL_STATUS = ['OPEN', 'ACCEPTED', 'COMPLETED', 'REJECTED', 'RESCHEDULED', 'CANCELED', 'CLAIMED'];

// Parse a getCallInfo SOAP response into a clean list of jobs.
function _tag(b, n) { const m = b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i')); return m ? m[1].trim() : ''; }
function parseCalls(raw) {
  const out = [];
  const re = /<CallInfo\b[^>]*>([\s\S]*?)<\/CallInfo>/gi;
  let m;
  while ((m = re.exec(raw || ''))) {
    const b = m[1];
    out.push({
      call_number: _tag(b, 'CallNumber'), fss_call_id: _tag(b, 'FSSCallId'), mfg_id: _tag(b, 'MfgId'),
      tech_key: _tag(b, 'TechKey'), group_key: _tag(b, 'GroupKey'), servicer_account: _tag(b, 'ServicerAccount'),
      status: _tag(b, 'CallStatus'), sp_status_id: _tag(b, 'SPCallStatusID'),
      sub_status: _tag(b, 'CallSubStatus'), sp_sub_status_id: _tag(b, 'SPCallSubStatusID'),
      first_name: _tag(b, 'ConsumerFirstName'), last_name: _tag(b, 'ConsumerLastName'),
      city: _tag(b, 'PostcodeLevel3'), state: _tag(b, 'PostcodeLevel1'), zip: _tag(b, 'Postcode'),
      brand: _tag(b, 'SPBrandDesc'), product: _tag(b, 'SPProductDesc'), model: _tag(b, 'MobelNo'),
      problem: _tag(b, 'ProbelmDesc'), warranty_type: _tag(b, 'WarrantyType'), service_type: _tag(b, 'ServicetType'),
      schedule_date: _tag(b, 'ScheduleDate'), schedule_time: _tag(b, 'ScheduleTimePeriod'),
      created_on: _tag(b, 'CallCreatedOn'),
    });
  }
  return out;
}

// ─── CAPACITY (the "get more work" lever) ─────────────────────────────────
// getTechInfo: READ our techs + their TechKey (Key) + current weekly BasicCapacity
// {Capacity, Day, TimeBand}. Answers "are we still capped at N/day?" and yields the
// TechKeys needed to RAISE capacity. READ-ONLY — safe.
async function getTechInfo({ key } = {}) {
  const ui = await userInfoXml();
  const f = (tag, v) => (v == null || v === '' ? '' : `<${tag}>${esc(v)}</${tag}>`);   // unqualified children
  const inner = `<impl:getTechInfo>${ui}${f('Key', key)}</impl:getTechInfo>`;
  const r = await soapCall(inner, '');
  r.techs = parseTechs(r.raw || '');
  return r;
}

function parseTechs(raw) {
  const out = [];
  const re = /<(?:\w+:)?TechInfo\b[^>]*>([\s\S]*?)<\/(?:\w+:)?TechInfo>/gi;
  let m;
  while ((m = re.exec(raw || ''))) {
    const b = m[1];
    const caps = [];
    const cre = /<(?:\w+:)?BasicCapacity\b[^>]*>([\s\S]*?)<\/(?:\w+:)?BasicCapacity>/gi;
    let c;
    while ((c = cre.exec(b))) caps.push({ capacity: _tag(c[1], 'Capacity'), day: _tag(c[1], 'Day'), time_band: _tag(c[1], 'TimeBand') });
    out.push({ key: _tag(b, 'Key'), name: _tag(b, 'Name'), group_key: _tag(b, 'GroupKey'), cell: _tag(b, 'CellPhone'), basic_capacity: caps });
  }
  return out.filter((t) => t.key || t.name || t.basic_capacity.length);
}

// updateTechInfo: set a tech's RECURRING weekly BasicCapacity (per day × time band).
// caps = [{capacity, day:'MON'..'SUN', timeBand:'8-17'|'8-12'|'12-17'|'17-21'|'6-8'}]
async function updateTechInfo({ key, name, groupKey, cellPhone, caps }) {
  const ui = await userInfoXml();
  const f = (tag, v) => (v == null || v === '' ? '' : `<${tag}>${esc(v)}</${tag}>`);
  const capXml = (caps || []).map((c) => `<BasicCapacity>${f('Capacity', String(c.capacity))}${f('Day', c.day)}${f('TimeBand', c.timeBand || c.time_band)}</BasicCapacity>`).join('');
  const inner = `<impl:updateTechInfo>${ui}${f('Name', name)}${f('Key', key)}${f('GroupKey', groupKey)}${f('CellPhone', cellPhone)}${capXml}</impl:updateTechInfo>`;
  return soapCall(inner, '');
}

// updateTechCapacity: one-shot capacity override for a TechKey on a SPECIFIC date+band.
async function updateTechCapacity({ key, capacity, date, timeBand }) {
  const ui = await userInfoXml();
  const f = (tag, v) => (v == null || v === '' ? '' : `<${tag}>${esc(v)}</${tag}>`);
  const inner = `<impl:updateTechCapacity>${ui}${f('TechKey', key)}${f('Capacity', String(capacity))}${f('Datetime', date)}${f('Timeband', timeBand)}</impl:updateTechCapacity>`;
  return soapCall(inner, '');
}

const TIME_BANDS = { '8-12': 'MORNING', '12-17': 'AFTERNOON', '8-17': 'ALL DAY', '17-21': 'EVENING', '6-8': 'EARLY MORNING' };

module.exports = { isConfigured, serviceUrl, soapCall, getTestService, getCallInfo, updateCallInfo, parseCalls, getTechInfo, parseTechs, updateTechInfo, updateTechCapacity, TIME_BANDS, CALL_STATUS, NS };
