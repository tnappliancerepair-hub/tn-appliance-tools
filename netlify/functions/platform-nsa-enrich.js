// platform-nsa-enrich — fill the blanks on NSA cards the claim key cannot reach.
//
// WHY THIS IS A SEPARATE SWEEP AND NOT A BRANCH INSIDE createWarrantyJob:
// 126 of 236 NSA rows on this board carry an EMPTY claim_number, because Xano's generic
// intake never extracted one. An empty key matches no dispatch, so the claim-keyed
// enrichment on the intake path can never see those cards. The only remaining handle is
// the customer's identity - and identity must NEVER be allowed to influence the
// dedup-vs-create decision. The same customer legitimately has several NSA dispatches
// over time; keying a dedup on identity would collapse two real jobs into one, and
// "wrongly collapsing two real jobs loses work, a twin only costs a card."
//
// So this READS ONLY and enriches. It never creates a job, never dedupes one, never
// touches status, problem, schedule, tech, or parts.
//
// AND IT REFUSES ON AMBIGUITY. If identity resolves to more than one blind NSA job the
// sweep writes nothing and says so. Writing the wrong model onto a card is worse than
// leaving it blank - a tech orders the wrong part off it.
//
// DRY BY DEFAULT. &confirm=yes writes.
//   GET ?secret=<admin>[&q=<gmail query>][&days=N][&max=N][&confirm=yes][&budget_ms=N]
//
// One-shot cleanup, deliberately NOT on a cron: the intake's claim-keyed enrichment
// already covers every dispatch arriving from here on.
'use strict';

const { getSecret } = require('./_lib/secrets');
// lazy - so the resolver stays requirable (and unit-testable) without the Gmail deps
let _readMany = null;
function readMany(q, o) {
  if (!_readMany) _readMany = require('./_lib/gmail-accounts').readMany;
  return _readMany(q, o);
}
const { enrichBlanks } = require('./_lib/platform-warranty-db');
const { parseNsaDispatch } = require('./_lib/parsers/nsa');

const SLUG_DEFAULT = 'tn-appliance-exchange-llc';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function digits10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
// PostgREST ilike treats * as the wildcard, and a name is user-shaped text. Strip the
// wildcards rather than escape them - a last name has no business carrying one.
function safeLike(v) { return String(v || '').replace(/[*%_,()]/g, ' ').trim(); }
function blank(v) { return !String(v == null ? '' : v).trim(); }

async function cfg() {
  return {
    url: (await getSecret('PLATFORM_SUPABASE_URL')) || '',
    key: (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '',
  };
}

function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(9000) });
      if (!r.ok) return [];
      return r.json();
    },
    async patch(table, filter, body) {
      const r = await fetch(`${base}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error('patch ' + table + ' ' + r.status);
      return true;
    },
  };
}

// Is this unit blind? Model is the field a tech actually needs to order a part, so it is
// the test for "this card cannot be worked from".
function isBlind(unit) {
  const a = (unit && unit.attributes) || {};
  return blank(a.model);
}

async function unitsFor(db, jobs) {
  const ids = [...new Set(jobs.map((j) => j.unit_id).filter(Boolean))];
  if (!ids.length) return {};
  // in.() takes UUIDs UNQUOTED - a quoted list reads as no match and the sweep would
  // silently conclude every card is blind.
  const rows = await db.get(`unit?id=in.(${ids.join(',')})&select=id,label,attributes`);
  const by = {};
  for (const u of rows || []) by[u.id] = u;
  return by;
}

// claim first, then dispatch#, then identity. Same-column only on the keys, never crossed.
async function resolveTarget(db, companyId, n) {
  const sel = 'select=id,unit_id,dispatch_id,service_window,status,claim_number,customer_id';

  for (const [col, val] of [['claim_number', n.claim_number], ['dispatch_id', n.dispatch_id]]) {
    const key = String(val || '').trim();
    if (!key) continue;
    const rows = await db.get(`job?company_id=eq.${companyId}&${col}=eq.${encodeURIComponent(key)}&${sel}&limit=2`);
    if (rows && rows.length === 1) return { job: rows[0], matched_by: col };
    if (rows && rows.length > 1) return { refused: 'ambiguous_key:' + col + ':' + rows.length };
  }

  // identity: last name + phone. Both required - a last name alone is far too loose.
  const last = safeLike(n.last);
  const ph = digits10(n.phone);
  if (!last || ph.length !== 10) return { refused: 'no_key_and_no_identity' };

  const cust = await db.get(`customer?company_id=eq.${companyId}&last_name=ilike.${encodeURIComponent(last)}&select=id,first_name,last_name,phone&limit=200`);
  const ids = (cust || []).filter((c) => digits10(c.phone) === ph).map((c) => c.id);
  if (!ids.length) return { refused: 'no_customer_by_identity' };

  const jobs = await db.get(`job?company_id=eq.${companyId}&customer_id=in.(${ids.join(',')})&warranty_company=ilike.*nsa*&${sel}&limit=50`);
  if (!jobs || !jobs.length) return { refused: 'customer_has_no_nsa_job' };

  const units = await unitsFor(db, jobs);
  const blind = jobs.filter((j) => isBlind(units[j.unit_id]));
  if (!blind.length) return { refused: 'nothing_blind_to_fill' };
  // Exactly one, or nothing. No preference ranking here on purpose - a ranking silently
  // picks a card, and the cost of picking wrong is a wrong model on a real ticket.
  if (blind.length > 1) return { refused: 'ambiguous_identity:' + blind.length };
  return { job: blind[0], matched_by: 'identity' };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const live = q.confirm === 'yes';
  const t0 = Date.now();
  const budgetMs = Math.max(3000, Math.min(600000, parseInt(q.budget_ms || '20000', 10) || 20000));

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);

  const slug = q.slug || SLUG_DEFAULT;
  const cos = await db.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name&limit=1`);
  const co = cos && cos[0];
  if (!co) return json(200, { ok: false, error: 'unknown_shop:' + slug });

  const days = Math.max(1, Math.min(365, parseInt(q.days || '30', 10) || 30));
  const query = q.q || `-in:sent subject:"NSA Dispatch for" newer_than:${days}d`;
  const max = Math.max(1, Math.min(200, parseInt(q.max || '40', 10) || 40));

  let msgs = [];
  try { msgs = await readMany(query, { max }); } catch (e) { return json(200, { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }); }

  const out = {
    ok: true, live, shop: co.name, query, max, scanned: msgs.length,
    dispatches: 0, enriched: 0, fields_filled: 0, refused: 0, by_match: {}, refusals: {}, results: [],
  };

  // The same dispatch lands in several connected inboxes with different Gmail ids. Dedupe
  // on the NATURAL key so one dispatch is one unit of work however many inboxes saw it.
  const seen = new Set();

  for (const m of msgs) {
    if (Date.now() - t0 > budgetMs) { out.stopped_on_budget = true; out.remaining = msgs.length - out.results.length; break; }

    let p;
    try { p = parseNsaDispatch({ subject: m.subject, from: m.from, text: m.body }); } catch (e) { p = null; }
    if (!p || !p.is_job || !p.job) { out.refused++; out.refusals[(p && p.email_type) || 'unparsed'] = (out.refusals[(p && p.email_type) || 'unparsed'] || 0) + 1; continue; }

    const n = p.job;
    const natural = [String(n.claim_number || ''), String(n.dispatch_id || '')].join('|');
    if (seen.has(natural)) continue;
    seen.add(natural);
    out.dispatches++;

    const row = { case: n.claim_number, dispatch: n.dispatch_id, customer: [n.first, n.last].filter(Boolean).join(' ') };
    let r;
    try { r = await resolveTarget(db, co.id, n); } catch (e) { r = { refused: 'lookup_error:' + String((e && e.message) || e).slice(0, 60) }; }

    if (r.refused) {
      out.refused++;
      const bucket = String(r.refused).split(':')[0];
      out.refusals[bucket] = (out.refusals[bucket] || 0) + 1;
      out.results.push({ ...row, refused: r.refused });
      continue;
    }

    let filled = [];
    try { filled = await enrichBlanks(db, co.id, r.job, n, { dry: !live }); } catch (e) { filled = ['error:' + String((e && e.message) || e).slice(0, 60)]; }
    if (filled.length) { out.enriched++; out.fields_filled += filled.length; }
    out.by_match[r.matched_by] = (out.by_match[r.matched_by] || 0) + 1;
    out.results.push({ ...row, job_id: r.job.id, matched_by: r.matched_by, would_fill: !live ? filled : undefined, filled: live ? filled : undefined });
  }

  return json(200, out);
};

// exported for tests - the refusal behaviour is the safety property worth asserting
exports._resolveTarget = resolveTarget;
exports._digits10 = digits10;
exports._safeLike = safeLike;
exports._isBlind = isBlind;
