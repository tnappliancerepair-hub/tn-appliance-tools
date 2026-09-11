// platform-unanswered — nobody's message falls through.
//
// WHY THIS EXISTS. Measured on TN 2026-09-11: 100 inbound customer texts in 7 days against
// 12 logged replies, and right now 41 customers whose LAST word has no logged reply after
// it -- 21 of them waiting over 24 hours, averaging 26 hours.
//
// Some of those people were certainly answered by phone. That is exactly the problem: from
// the outside nobody can tell an answered-by-phone from a dropped one, so neither gets
// chased. This turns "probably fine" into a list somebody can actually clear.
//
// It is deliberately a QUEUE, NOT A TEXTER. It sends nothing to anyone -- the standing owner
// rule is no proactive customer texts, and a watcher that starts messaging people would be
// the exact thing that rule exists to prevent. It surfaces, a human answers.
//
// ⚠️ THE DESIGN POINT THAT MAKES OR BREAKS IT: a queue you cannot clear gets abandoned. Most
// of these were handled on the phone, so without a one-tap dismiss the list would be mostly
// noise inside a week and the office would stop opening it. Dismissals are recorded as
// events, NOT as thread messages, so clearing the queue never puts a fake reply in front of
// the customer.
//
//   POST { access_token, do:'list' }                     who is waiting, oldest first
//   POST { access_token, do:'dismiss', message_id, ... } handled (usually: answered by phone)
//
// Tenant-generic: the company comes from the caller's own session, never a constant.
'use strict';

const { getSecret } = require('./_lib/secrets');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// System notes share the thread with real messages. These prefixes are written BY us
// (waiver signed, dispatch received, tech note) and must never look like a customer waiting.
const SYSTEM_PREFIX = /^\s*(✍️|📥|👤|🤖|🔧|🛒|📸|🧾|💵|🚚|⚠️|✅)/;

// Buckets validated against 88 real TN customer messages rather than invented. Order
// matters: the first match wins, so the ones that need a human fastest are tested first.
const INTENT = [
  ['still broken', /\b(still (not|isn|does|won)|not fixed|(not sure|unsure).{0,20}fixed|same (problem|issue|sound|noise)|sounds? the same|does the same|broke again|stopped again|worse|didn'?t (work|fix)|come back|another (service|tech|request))\b/i],
  ['wants a call', /\b(call me|please call|give me a call|call (her|him|my)|reach me)\b/i],
  ['scheduling', /\b(availab|resched|works for|that works|not available|(will not|won'?t|does not|doesn'?t) work|can'?t do|another day|what time|time slot|morning|afternoon|monday|tuesday|wednesday|thursday|friday|appointment|yes.{0,6}(that|this) (works|time))\b/i],
  ['where is the tech', /\b(on the way|otw|\beta\b|how long|when will|arriv|running late|still coming|show up|no.?show|ahead of|heads? up)\b/i],
  ['parts', /\b(part|ordered|backorder|shipped|in stock|when will it (arrive|come))\b/i],
  ['access info', /\b(door code|gate code|garage|lockbox|key is|code is|dog|back door)\b/i],
  ['money', /\b(invoice|pay|paid|bill|cost|charge|deductible|price|quote|refund)\b/i],
];
function classify(body) {
  const b = String(body || '');
  for (const [name, re] of INTENT) if (re.test(b)) return name;
  return 'other';
}

function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(9000) });
      return r.ok ? (await r.json().catch(() => [])) : [];
    },
    async insert(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify(row), signal: AbortSignal.timeout(9000),
      });
      return r.ok;
    },
  };
}

async function authUser(base, key, token) {
  if (!token) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return r.json().catch(() => null);
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}
  const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return json(200, { ok: false, error: 'platform not configured' });

  const u = await authUser(url, key, String(p.access_token || '').trim());
  if (!u || !u.id) return json(200, { ok: false, error: 'not_signed_in' });
  const db = rest(url, key);
  const me = (await db.get(`app_user?auth_user_id=eq.${u.id}&select=company_id,name,role&limit=1`))[0];
  const companyId = me && me.company_id;
  if (!companyId) return json(200, { ok: false, error: 'no_company' });

  // ── dismiss ────────────────────────────────────────────────────────────────
  // Recorded as an EVENT, never a thread_message: clearing the queue must not put words
  // in front of the customer that nobody actually said to them.
  if (p.do === 'dismiss') {
    const mid = String(p.message_id || '').trim();
    if (!mid) return json(200, { ok: false, error: 'message_id required' });
    const ok = await db.insert('event', {
      company_id: companyId, type: 'reply_not_needed', entity: 'thread_message',
      payload: { message_id: mid, customer_id: p.customer_id || null, by: (me && me.name) || 'office', reason: String(p.reason || 'handled'), at: new Date().toISOString() },
    });
    return json(200, { ok, message_id: mid });
  }

  // ── list ───────────────────────────────────────────────────────────────────
  const days = Math.max(1, Math.min(60, Number(p.days) || 21));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const msgs = await db.get(
    `thread_message?company_id=eq.${companyId}&customer_id=not.is.null&created_at=gte.${encodeURIComponent(since)}` +
    `&select=id,customer_id,job_id,direction,body,created_at,sender&order=created_at.asc&limit=4000`,
  );
  if (!Array.isArray(msgs) || !msgs.length) return json(200, { ok: true, waiting: [], count: 0 });

  // Last real customer message per person, and whether anything went out after it.
  const lastIn = new Map(); const lastOutAt = new Map();
  for (const m of msgs) {
    const cid = m.customer_id; if (!cid) continue;
    if (m.direction === 'out') { lastOutAt.set(cid, m.created_at); continue; }
    const body = String(m.body || '').trim();
    if (body.length < 4 || SYSTEM_PREFIX.test(body)) continue;
    lastIn.set(cid, m);
  }

  const dismissed = new Set();
  for (const e of (await db.get(`event?company_id=eq.${companyId}&type=eq.reply_not_needed&select=payload&limit=2000`)) || []) {
    const id = e && e.payload && e.payload.message_id; if (id) dismissed.add(String(id));
  }

  const open = [];
  for (const [cid, m] of lastIn) {
    const out = lastOutAt.get(cid);
    if (out && new Date(out) > new Date(m.created_at)) continue;   // answered after they wrote
    if (dismissed.has(String(m.id))) continue;
    open.push({ cid, m });
  }
  if (!open.length) return json(200, { ok: true, waiting: [], count: 0 });

  // Hydrate just the people and jobs we need, in two reads rather than per-row.
  const ids = [...new Set(open.map((o) => o.cid))];
  const people = {}; const jobs = {};
  for (let i = 0; i < ids.length; i += 100) {
    for (const c of (await db.get(`customer?id=in.(${ids.slice(i, i + 100).join(',')})&select=id,first_name,last_name,phone,city&limit=200`)) || []) people[c.id] = c;
  }
  const jids = [...new Set(open.map((o) => o.m.job_id).filter(Boolean))];
  for (let i = 0; i < jids.length; i += 100) {
    for (const j of (await db.get(`job?id=in.(${jids.slice(i, i + 100).join(',')})&select=id,status,problem,scheduled_day,parts_status&limit=200`)) || []) jobs[j.id] = j;
  }

  const now = Date.now();
  const waiting = open.map(({ cid, m }) => {
    const c = people[cid] || {}; const j = jobs[m.job_id] || null;
    const hours = Math.round(((now - new Date(m.created_at).getTime()) / 3600000) * 10) / 10;
    return {
      message_id: m.id, customer_id: cid, job_id: m.job_id || null,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)',
      phone: c.phone || '', city: c.city || '',
      said: String(m.body || '').replace(/\s+/g, ' ').slice(0, 220),
      at: m.created_at, hours_waiting: hours,
      intent: classify(m.body),
      // Enough context to answer without opening another tab -- the whole point is that
      // whoever clears this list should not have to go hunting first.
      job: j ? { status: j.status, day: j.scheduled_day, problem: String(j.problem || '').slice(0, 90), parts: j.parts_status || null } : null,
    };
  }).sort((a, b) => b.hours_waiting - a.hours_waiting);

  const byIntent = {};
  for (const w of waiting) byIntent[w.intent] = (byIntent[w.intent] || 0) + 1;

  return json(200, {
    ok: true, count: waiting.length,
    over_24h: waiting.filter((w) => w.hours_waiting >= 24).length,
    by_intent: byIntent, waiting: waiting.slice(0, 200),
  });
};
