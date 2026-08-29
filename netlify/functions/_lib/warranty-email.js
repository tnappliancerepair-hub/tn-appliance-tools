// warranty-email — turn ANY warranty dispatch email into a normalized job record.
//
// Three tiers, best-first:
//   1. Known-vendor parsers (deterministic, fast): AHS/Frontdoor XML, ServicePower/SquareTrade text.
//   2. Claude fallback: reads a dispatch email we've never seen and extracts the same fields.
//      THIS is the moat — onboarding a brand-new warranty company needs zero new code.
//   3. If even Claude can't find a customer, we return no jobs (logged as unparsed for the owner).
//
// A normalized job:
//   { first, last, phone, email, address, city, state, zip, appliance, brand, model, serial,
//     claim_number, dispatch_id, warranty_company, problem, service_window }
//
// extractJobs(email) -> { vendor, method, email_type, confidence, jobs:[normalized...] , note }
'use strict';

const { getSecret } = require('./secrets');
let parseServicePowerBody; try { ({ parseServicePowerBody } = require('./parsers/servicepower')); } catch (_) { parseServicePowerBody = null; }

const INTAKE_DOMAIN = 'jobs.assistant247.net';
// Haiku for the fallback: fast enough to finish inside a synchronous function, cheap per email,
// and plenty accurate for field extraction. Known vendors never hit the LLM — this is only for
// a format we have no parser for.
const MODEL = 'claude-haiku-4-5-20251001';

// ── small text helpers ──────────────────────────────────────────────
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function stripHtml(h) {
  return decodeEntities(String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|tr|li|br|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).trim(); }
function digits10(s) { const d = String(s || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d.slice(-10); }
function splitName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim();
  if (!s) return { first: '', last: '' };
  // handle "Last, First"
  if (s.includes(',')) { const [l, f] = s.split(','); return { first: titleCase((f || '').trim()), last: titleCase((l || '').trim()) }; }
  const p = s.split(' '); return { first: titleCase(p[0]), last: titleCase(p.slice(1).join(' ')) };
}
const APPL = [
  [/\b(refrig|fridge|freezer|ice ?maker|icemaker)\b/i, 'refrigerator'],
  [/\b(washer|washing machine|front load|top load)\b/i, 'washer'],
  [/\b(dryer)\b/i, 'dryer'],
  [/\b(dish ?washer)\b/i, 'dishwasher'],
  [/\b(range|stove|oven|cook ?top|cooking)\b/i, 'range'],
  [/\b(microwave)\b/i, 'microwave'],
  [/\b(disposal|garbage)\b/i, 'disposal'],
  [/\b(water heater)\b/i, 'water heater'],
];
function canonAppliance(raw) {
  const s = String(raw || '');
  for (const [re, kind] of APPL) if (re.test(s)) return kind;
  return s.trim().toLowerCase() || '';
}

// ── vendor detection ────────────────────────────────────────────────
function detectVendor(email) {
  const from = String(email.from || '').toLowerCase();
  const sub = String(email.subject || '').toLowerCase();
  const body = String(email.text || email.html || '').toLowerCase();
  const hay = from + ' ' + sub + ' ' + body;
  if (/frontdoor|american home shield|\bahs\b|msg\.frontdoor/.test(hay) || (email.xml && /<VendorDispatch|<DispatchList|<CoveredProperty/i.test(email.xml))) return 'ahs';
  if (/square ?trade|allstate/.test(hay)) return 'squaretrade';
  if (/servicepower|service power/.test(hay)) return 'servicepower';
  return 'unknown';
}

// ── AHS / Frontdoor XML parser (JS port of the proven ahs_email_intake tag-splitting) ──
function xmlFirstEl(xml, tag) { const m = new RegExp('<' + tag + '\\b[^>]*>', 'i').exec(xml || ''); return m ? m[0] : ''; }
function attrOf(el, name) { const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(el || ''); return m ? decodeEntities(m[1]).trim() : ''; }
function parseAhsXml(xml) {
  xml = String(xml || '');
  if (!/<[A-Za-z]/.test(xml)) return null;
  const dl = xmlFirstEl(xml, 'DispatchList');
  const cp = xmlFirstEl(xml, 'CoveredProperty');
  const wl = xmlFirstEl(xml, 'WorkOrderLineList') || xmlFirstEl(xml, 'WorkOrderLine');
  const brandEl = (new RegExp('<Attribute\\b[^>]*Name\\s*=\\s*"Brand"[^>]*>', 'i').exec(xml) || [''])[0];
  const symEl = xmlFirstEl(xml, 'Symptom');
  const custEl = xmlFirstEl(xml, 'ContractCustomer');
  // phone: prefer CELL, else the first PhoneNumber
  let phone = '';
  const cell = (new RegExp('<PhoneNumber\\b[^>]*Type\\s*=\\s*"CELL"[^>]*>', 'i').exec(xml) || [''])[0];
  phone = digits10(attrOf(cell, 'Number')) || digits10(attrOf(xmlFirstEl(xml, 'PhoneNumber'), 'Number'));
  const streetNo = attrOf(cp, 'StreetNumber'), streetNm = attrOf(cp, 'StreetName'), unitNo = attrOf(cp, 'UnitNumber');
  const address = [streetNo, streetNm, unitNo && ('#' + unitNo)].filter(Boolean).join(' ').trim();
  const rawName = attrOf(custEl, 'Name');
  const primaryName = rawName.split('&')[0].trim();  // primary contract holder
  const { first, last } = splitName(primaryName);
  const claim = attrOf(dl, 'Id');
  const applianceRaw = attrOf(wl, 'Description');
  const symptom = attrOf(symEl, 'Name');
  const brand = attrOf(brandEl, 'Value');
  if (!claim && !rawName && !address) return null;
  return {
    first, last, phone,
    email: attrOf(xmlFirstEl(xml, 'Email'), 'Address') || '',
    address, city: titleCase(attrOf(cp, 'CityName')), state: attrOf(cp, 'StateCode').toUpperCase(), zip: attrOf(cp, 'ZipPostCode'),
    appliance: canonAppliance(applianceRaw), brand: titleCase(brand), model: '', serial: '',
    claim_number: claim, dispatch_id: attrOf(dl, 'DispatchNumber') || claim,
    warranty_company: 'AHS', problem: symptom || applianceRaw || '',
    service_window: attrOf(dl, 'DispatchDateTime') || '',
  };
}

// ── ServicePower / SquareTrade (reuse the proven state-machine parser) ──
function fromServicePower(email) {
  if (!parseServicePowerBody) return null;
  const body = String(email.text || stripHtml(email.html) || '');
  let out; try { out = parseServicePowerBody(body, String(email.subject || '')); } catch (_) { return null; }
  if (!out) return null;
  const NEWJOB = { DISPATCH_OFFER: 1, DISPATCH_OFFER_ACCEPTED: 1, SCHEDULE_CHANGE: 1 };
  const isJob = !!NEWJOB[out.email_type];
  const jobs = (out.dispatches || []).map((d) => {
    const c = d.customer || {};
    const co = /square ?trade|allstate/i.test(String(d.source || '') + ' ' + String(email.from || '')) ? 'SquareTrade' : 'ServicePower';
    return {
      first: titleCase(c.first_name || ''), last: titleCase(c.last_name || ''),
      phone: digits10(c.cell_phone || c.home_phone || c.work_phone || c.raw_phone || ''),
      email: c.email || '', address: titleCase(c.raw_street || ''), city: titleCase(c.raw_city || ''),
      state: String(c.raw_state || '').toUpperCase(), zip: c.raw_zip || '',
      appliance: canonAppliance(d.appliance_type || d.product_raw || ''), brand: titleCase(d.brand || ''),
      model: d.model || '', serial: d.serial || '',
      claim_number: d.call_number || '', dispatch_id: d.call_number || '',
      warranty_company: co, problem: d.problem || '', service_window: d.schedule_window || '',
    };
  }).filter((j) => j.claim_number || j.last || j.address);
  return { email_type: out.email_type, is_job: isJob, jobs: isJob ? jobs : [] };
}

// ── Claude fallback: extract the same fields from ANY dispatch email ──
async function parseWithClaude(email) {
  const key = (await getSecret('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY || '';
  if (!key) return null;
  const body = (email.text || stripHtml(email.html) || '').slice(0, 12000);
  const xml = email.xml ? ('\n\n[ATTACHMENT XML]\n' + String(email.xml).slice(0, 8000)) : '';
  const sys = 'You read a home-warranty / service-contract DISPATCH email and extract the service job as strict JSON. '
    + 'Warranty companies (AHS, ServicePower, SquareTrade, Frontdoor, NSA, Cinch, 2-10, etc.) email these to the repair shop. '
    + 'Return ONLY a JSON object, no prose. Shape: '
    + '{"is_dispatch":true|false,"email_type":"dispatch|status|payment|other","confidence":"high|medium|low","warranty_company":"","jobs":[{'
    + '"first":"","last":"","phone":"","email":"","address":"","city":"","state":"","zip":"","appliance":"refrigerator|washer|dryer|dishwasher|range|microwave|disposal|water heater|other","brand":"","model":"","serial":"","claim_number":"","dispatch_id":"","problem":"","service_window":""}]}. '
    + 'is_dispatch=false for payment remittances, status-request reminders, or anything that is not a NEW job to schedule (then jobs=[]). '
    + 'Normalize appliance to one lowercase word from the list. phone = digits only. Never invent a value; leave it "" if not present. A dispatch can list more than one appliance = more than one job.';
  const usr = 'FROM: ' + (email.from || '') + '\nSUBJECT: ' + (email.subject || '') + '\n\n' + body + xml;
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 18000);
    let resp; try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, messages: [{ role: 'user', content: usr }] }),
        signal: ac.signal,
      });
    } finally { clearTimeout(to); }
    if (!resp.ok) return null;
    const data = await resp.json();
    let txt = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const m = txt.indexOf('{'); if (m > 0) txt = txt.slice(m);
    const j = JSON.parse(txt);
    const jobs = (Array.isArray(j.jobs) ? j.jobs : []).map((x) => ({
      first: titleCase(x.first || ''), last: titleCase(x.last || ''), phone: digits10(x.phone || ''),
      email: x.email || '', address: titleCase(x.address || ''), city: titleCase(x.city || ''),
      state: String(x.state || '').toUpperCase(), zip: String(x.zip || ''),
      appliance: canonAppliance(x.appliance || ''), brand: titleCase(x.brand || ''), model: x.model || '', serial: x.serial || '',
      claim_number: String(x.claim_number || ''), dispatch_id: String(x.dispatch_id || x.claim_number || ''),
      warranty_company: titleCase(j.warranty_company || x.warranty_company || ''), problem: x.problem || '',
      service_window: x.service_window || '',
    })).filter((x) => x.last || x.address || x.claim_number);
    return { is_dispatch: j.is_dispatch !== false && jobs.length > 0, email_type: j.email_type || 'other', confidence: j.confidence || 'medium', jobs: j.is_dispatch === false ? [] : jobs };
  } catch (_) { return null; }
}

// ── the one entry point ─────────────────────────────────────────────
async function extractJobs(email) {
  const vendor = detectVendor(email);
  // 1) known vendors first
  if (vendor === 'ahs' && email.xml) {
    const j = parseAhsXml(email.xml);
    if (j && j.claim_number) return { vendor, method: 'ahs_xml', email_type: 'dispatch', confidence: 'high', jobs: [j] };
  }
  if (vendor === 'servicepower' || vendor === 'squaretrade') {
    const sp = fromServicePower(email);
    if (sp && sp.jobs.length) return { vendor, method: 'servicepower', email_type: sp.email_type || 'dispatch', confidence: 'high', jobs: sp.jobs };
    if (sp && !sp.is_job) return { vendor, method: 'servicepower', email_type: sp.email_type || 'status', confidence: 'high', jobs: [], note: 'not a new dispatch (' + (sp.email_type || '') + ')' };
  }
  // 2) Claude fallback — unknown vendor, or a known vendor whose parser came up empty
  const c = await parseWithClaude(email);
  if (c) {
    if (!c.is_dispatch || !c.jobs.length) return { vendor, method: 'claude', email_type: c.email_type, confidence: c.confidence, jobs: [], note: 'Claude: not a new dispatch (' + c.email_type + ')' };
    return { vendor: vendor === 'unknown' ? (c.jobs[0].warranty_company ? c.jobs[0].warranty_company.toLowerCase() : 'unknown') : vendor, method: 'claude', email_type: 'dispatch', confidence: c.confidence, jobs: c.jobs };
  }
  return { vendor, method: 'none', email_type: 'unknown', confidence: 'low', jobs: [], note: 'could not parse' };
}

module.exports = { extractJobs, detectVendor, parseAhsXml, fromServicePower, parseWithClaude, canonAppliance, stripHtml, splitName, digits10, INTAKE_DOMAIN };
