// platform-call-brain — the data-aware phone brain for a shop's Ann (multi-tenant).
//
// This is the platform port of TN's job-truth: given the dialed shop (slug) + a caller handle
// (phone / claim# / name), it resolves WHO is calling and their current job on THAT shop's
// board, then composes the exact grounded sentence per audience (homeowner / warranty rep /
// office). Ann reads the composed line — she never guesses. Everything is company-scoped: the
// slug resolves company_id, and the SECURITY-DEFINER resolver is called with that id, so a
// caller for shop X can never surface shop Y's data.
//
//   POST/GET ?do=lookup   { slug, phone?, claim?, name? , lens? }
//     -> { ok, found, matched_by, customer, job, answers:{customer,warranty,office} }
//
// GROUNDING (ported from job-truth):
//   - DAY ONLY, never a clock time (scheduled_day is a date; scheduled_start is a routing
//     placeholder, never spoken).
//   - No tech name we don't have -> "your technician".
//   - Never say "canceled" to a homeowner -> the office confirms.
//   - Completed + warranty -> recall redirect.
//   - Homeowner never hears a part number or claim #; the warranty lens may.
//
// Gate: real slugs require ?k=<TELNYX_TOOL_SECRET> (matches the Ann tools); 'demo' is open.
'use strict';

const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}

// friendly CT day from a 'YYYY-MM-DD' date — noon-anchored so no timezone slips it a day.
function dayLabel(d) {
  const s = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(s)) return '';
  const dt = new Date(s + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
}

const TERMINAL = { completed: 1, canceled: 1 };
const AWAIT_PARTS = { awaiting_parts: 1, ordered: 1, on_order: 1, pending: 1, to_order: 1 };

// compose the three grounded answers from the resolved facts.
function compose(shopName, r) {
  const nm = (r.customer && (r.customer.first_name || '').trim()) || '';
  const hi = nm ? `Hi ${nm}` : 'Hi there';
  if (!r.found) {
    return {
      customer: `${hi} — I don't see an open job under that yet. Let's get you set up — what's going on with your appliance?`,
      warranty: `No job found for that handle on ${shopName}. Ask for the dispatch/claim number or the customer's name and address.`,
      office: `Unrecognized caller — no match by phone/claim/name.`,
    };
  }
  const j = r.job || null;
  const appl = (j && j.unit_label) ? j.unit_label : 'appliance';
  const tech = (j && (j.tech_first || '').trim()) || '';
  const techPhrase = tech ? tech : 'your technician';
  const day = j ? dayLabel(j.scheduled_day) : '';
  const st = j ? String(j.status || '') : '';
  const warranty = !!(j && String(j.warranty_company || '').trim());
  const partEta = j && j.parts_eta ? dayLabel(j.parts_eta) : '';

  // ---- customer (homeowner) lens: day-only, grounded, no part#/claim# ----
  let cust;
  if (!j) {
    cust = `${hi} — I've got your info here. We're getting you scheduled; you'll get a text once your day is set.`;
  } else if (st === 'completed') {
    cust = warranty
      ? `${hi} — our records show that ${appl} repair was completed. If it's acting up again, the fastest fix is to open a recall with your warranty company, and we'll come right back out.`
      : `${hi} — that ${appl} job is marked complete. Anything else I can help with?`;
  } else if (st === 'canceled') {
    cust = `${hi} — let me have the office confirm the details on your ${appl} and get right back to you.`;
  } else if (AWAIT_PARTS[st] || AWAIT_PARTS[String(j.parts_status || '')]) {
    cust = partEta
      ? `${hi} — your part for the ${appl} is on order, expected around ${partEta}. We'll text you to schedule the moment it lands.`
      : `${hi} — your part for the ${appl} is on order. We'll text you to schedule as soon as it arrives.`;
  } else if (day) {
    cust = `${hi} — you're scheduled with ${techPhrase} for ${day} for your ${appl}. We don't run exact times, but we'll text you a live arrival window that morning.`;
  } else {
    cust = `${hi} — we've got your ${appl} request and we're getting you scheduled. You'll get a text as soon as your day is set.`;
  }

  // ---- warranty rep lens: whole status in one breath; claim#/parts allowed ----
  let warr;
  if (!j) {
    warr = `${nm || 'That customer'} is on file but I don't see an active job — want me to open one?`;
  } else {
    const bits = [];
    bits.push(`${appl}${j.claim_number ? ` (claim ${j.claim_number})` : ''}`);
    if (st === 'completed') bits.push('completed');
    else if (st === 'canceled') bits.push('the office is confirming this one');
    else if (j.started_at) bits.push('tech on site');
    else if (j.en_route_at) bits.push(`${techPhrase} en route`);
    else if (AWAIT_PARTS[st] || AWAIT_PARTS[String(j.parts_status || '')]) bits.push(partEta ? `part on order, ETA ${partEta}` : 'part on order');
    else if (day) bits.push(`scheduled ${day} with ${techPhrase}`);
    else bits.push('being scheduled');
    if (j.service_window) bits.push(`window ${j.service_window}`);
    warr = bits.join(' — ') + '.';
  }

  // ---- office lens: terse + flags ----
  const flags = [];
  if (j && !tech && !TERMINAL[st]) flags.push('NO TECH');
  if (j && (AWAIT_PARTS[st] || AWAIT_PARTS[String(j.parts_status || '')])) flags.push('AWAITING PARTS' + (partEta ? ` (ETA ${partEta})` : ''));
  const office = j
    ? `${nm || 'Caller'} · ${appl} · ${st}${day ? ` · ${day}` : ''}${tech ? ` · ${tech}` : ''}${flags.length ? ` · ⚠ ${flags.join(', ')}` : ''}`
    : `${nm || 'Caller'} · on file, no active job`;

  return { customer: cust, warranty: warr, office };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}
  const g = (k) => (p[k] != null ? p[k] : q[k]);

  const doo = String(g('do') || 'lookup');
  const slug = String(g('slug') || '').toLowerCase().trim();
  if (!slug) return json(400, { ok: false, error: 'no_slug' });

  // tool-key gate for real shops; demo is an open sandbox
  if (slug !== 'demo') {
    const tk = await getSecret('TELNYX_TOOL_SECRET');
    if (tk && g('k') !== tk) return json(403, { ok: false, error: 'forbidden' });
  }

  // get_hours — the current CT day/time (LLMs guess "what time is it" wrong) + a default
  // office-open hint. No DB, so Ann can always check the clock even if the board blips.
  if (doo === 'hours') {
    const now = new Date();
    const now_ct = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(now);
    const h24 = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(now).replace(/\D/g, ''));
    const weekend = dow === 'Sat' || dow === 'Sun';
    const office_open = !weekend && h24 >= 8 && h24 < 18;
    return json(200, { ok: true, now_ct, office_open, note: "office_open is a default Mon-Fri 8am-6pm CT window; if the shop's stated hours differ, use those." });
  }

  const { url, key } = await cfg();
  if (!key) return json(200, { ok: false, error: 'platform_not_configured' });
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  // resolve company from the dialed shop's slug (code-scoping — every read is company-bound)
  let co;
  try {
    const r = await fetch(`${url}/rest/v1/company?slug=eq.${encodeURIComponent(slug)}&select=id,name&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) });
    co = ((await r.json().catch(() => []))[0]);
  } catch (_) { return json(200, { ok: false, error: 'db_unreachable' }); }
  if (!co) return json(200, { ok: false, error: 'unknown_shop:' + slug });

  if (doo === 'lookup') {
    const body = {
      p_company_id: co.id,
      p_phone: g('phone') ? String(g('phone')) : null,
      p_claim: g('claim') ? String(g('claim')) : null,
      p_name: g('name') ? String(g('name')) : null,
    };
    let facts;
    try {
      const r = await fetch(`${url}/rest/v1/rpc/platform_call_lookup`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      facts = await r.json().catch(() => null);
      if (!r.ok || !facts) return json(200, { ok: false, error: 'lookup_failed' });
    } catch (_) { return json(200, { ok: false, error: 'lookup_timeout' }); }

    const answers = compose(co.name || slug, facts);
    const lens = String(g('lens') || '').toLowerCase();
    return json(200, {
      ok: true,
      found: !!facts.found,
      matched_by: facts.matched_by || null,
      customer: facts.customer || null,
      job: facts.job || null,
      job_count: facts.job_count || 0,
      answer: lens && answers[lens] ? answers[lens] : answers.customer,
      answers,
    });
  }

  return json(400, { ok: false, error: 'unknown do: ' + doo });
};
