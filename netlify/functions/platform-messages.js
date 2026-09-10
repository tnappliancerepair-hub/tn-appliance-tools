// platform-messages — THE conversation surface for the platform (Supabase / ANT Platforms).
// One shared thread per CUSTOMER that the office, the tech, and the customer all read from
// and write into. The office board's drawer already showed a per-JOB slice of this; Danielle
// needs the whole scroll — every text with a person, across all their jobs, in one place,
// plus the ability to text any customer freely without hunting for a job first.
//
// Everything is scoped to the caller's company IN CODE (we hold the service key, which
// bypasses RLS) — the caller's Supabase session resolves app_user.company_id and every
// query is filtered by it.
//
//   POST ?do=list    { access_token, limit? }              -> { ok, conversations:[...] }
//   POST ?do=thread  { access_token, customer }            -> { ok, customer, jobs, messages }
//   POST ?do=send    { access_token, customer, body, job? }-> { ok, texted, no_phone }
//   POST ?do=search  { access_token, q }                   -> { ok, customers:[...] }
//   POST ?do=tee_probe { secret, phone, body }             -> { ok, tee }   (owner-gated)
'use strict';

const { getSecret, getSecretStatus } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { try { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(9000) }); return r.ok ? r.json() : []; } catch (_) { return []; } },
    async insertRet(table, row) {
      try {
        const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) });
        const d = await r.json().catch(() => null); return Array.isArray(d) ? d[0] : d;
      } catch (_) { return null; }
    },
  };
}
async function authUser(base, key, accessToken) {
  if (!accessToken) return null;
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; const u = await r.json(); return (u && u.id) ? u : null;
  } catch (_) { return null; }
}
const nameOf = (c) => [c && c.first_name, c && c.last_name].filter(Boolean).join(' ').trim();

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const doo = String(q.do || p.do || 'list');

  const { url, key } = await cfg();
  if (!url || !key) {
    // A vault read that comes back empty means one of two very different things, and the
    // office was being shown the raw code for both. getSecretStatus knows which: a busy
    // vault is worth retrying, a genuinely unset key is not and needs us.
    let transient = false;
    try { const st = await getSecretStatus('PLATFORM_SUPABASE_SERVICE_KEY'); transient = st && st.ok === false; } catch (_) {}
    return json(200, { ok: false, error: 'platform_not_configured', retry: !!transient,
      message: transient ? 'The system is busy right now. Try that again in a moment.'
                         : 'Texting is not set up on this shop yet. Tell the office.' });
  }
  const db = rest(url, key);

  // ── tee_probe: owner-gated. Runs the inbound bridge for one phone + body so we can
  //    prove a customer reply lands in the thread without waiting on a real text. ──
  if (doo === 'tee_probe') {
    const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (String(p.secret || '') !== guard) return json(403, { ok: false, error: 'forbidden' });
    const out = await require('./_lib/platform-thread').teeInbound({
      phone: String(p.phone || ''), body: String(p.body || ''), channel: 'sms',
    });
    return json(200, { ok: !!out.ok, tee: out });
  }

  const u = await authUser(url, key, String(p.access_token || '').trim());
  if (!u) return json(200, { ok: false, error: 'not_signed_in' });
  const us = (await db.get(`app_user?auth_user_id=eq.${u.id}&select=company_id,name,role&limit=1`))[0];
  const companyId = us && us.company_id;
  if (!companyId) return json(200, { ok: false, error: 'no_company' });
  const myName = (us && us.name) || '';
  const myRole = String((us && us.role) || '').toLowerCase();
  const isTech = myRole === 'tech';

  try {
    // ── list: the inbox. Newest conversation first, one row per customer. ──
    if (doo === 'list') {
      const lim = Math.min(Math.max(parseInt(p.limit, 10) || 400, 50), 1000);
      const rows = await db.get(
        `thread_message?company_id=eq.${companyId}&customer_id=not.is.null` +
        `&select=customer_id,job_id,direction,channel,sender,body,created_at&order=created_at.desc&limit=${lim}`
      );
      const byCust = new Map();
      for (const m of rows) {
        let c = byCust.get(m.customer_id);
        if (!c) { c = { customer_id: m.customer_id, last: m, n: 0, last_in_at: null }; byCust.set(m.customer_id, c); }
        c.n++;
        if (m.direction === 'in' && !c.last_in_at) c.last_in_at = m.created_at;
      }
      const ids = [...byCust.keys()];
      let people = [];
      if (ids.length) {
        people = await db.get(`customer?id=in.(${ids.join(',')})&company_id=eq.${companyId}&select=id,first_name,last_name,phone,city&limit=1000`);
      }
      const pmap = new Map(people.map((c) => [c.id, c]));
      const conversations = [...byCust.values()]
        .filter((c) => pmap.has(c.customer_id))                 // company scope, enforced in code
        .map((c) => {
          const per = pmap.get(c.customer_id) || {};
          return {
            customer_id: c.customer_id,
            name: nameOf(per) || 'Customer',
            phone: per.phone || '',
            city: per.city || '',
            messages: c.n,
            last_body: String(c.last.body || '').slice(0, 200),
            last_at: c.last.created_at,
            last_direction: c.last.direction,
            last_sender: c.last.sender || '',
            // "they spoke last" is the office's real to-do signal
            needs_reply: c.last.direction === 'in',
          };
        })
        .sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
      return json(200, { ok: true, count: conversations.length, conversations });
    }

    // ── thread: the whole scroll for one person, across every job they've ever had. ──
    if (doo === 'thread') {
      const cid = String(p.customer || '').trim();
      if (!cid) return json(200, { ok: false, error: 'customer required' });
      const cus = (await db.get(`customer?id=eq.${cid}&company_id=eq.${companyId}&select=id,first_name,last_name,phone,email,address,city,state,zip&limit=1`))[0];
      if (!cus) return json(200, { ok: false, error: 'not_your_customer' });
      const [messages, jobs] = await Promise.all([
        db.get(`thread_message?company_id=eq.${companyId}&customer_id=eq.${cid}&select=id,job_id,direction,channel,sender,body,created_at&order=created_at.asc&limit=500`),
        db.get(`job?company_id=eq.${companyId}&customer_id=eq.${cid}&select=id,status,scheduled_day,problem&order=scheduled_day.desc.nullslast&limit=25`),
      ]);
      return json(200, { ok: true, customer: { ...cus, name: nameOf(cus) }, jobs, messages });
    }

    // ── send: a HUMAN texts the customer. Lands in the same thread all three seats read. ──
    if (doo === 'send') {
      const cid = String(p.customer || '').trim();
      const text = String(p.body || '').trim().slice(0, 1000);
      if (!cid) return json(200, { ok: false, error: 'customer required' });
      if (!text) return json(200, { ok: false, error: 'empty' });
      const cus = (await db.get(`customer?id=eq.${cid}&company_id=eq.${companyId}&select=id,first_name,phone&limit=1`))[0];
      if (!cus) return json(200, { ok: false, error: 'not_your_customer' });

      // Attach to a job when we can, so the job tile's slice of the thread stays complete.
      let jobId = String(p.job || '').trim() || null;
      if (jobId) {
        const ok = (await db.get(`job?id=eq.${jobId}&company_id=eq.${companyId}&customer_id=eq.${cid}&select=id&limit=1`))[0];
        if (!ok) jobId = null;
      }
      if (!jobId) {
        const open = (await db.get(`job?company_id=eq.${companyId}&customer_id=eq.${cid}&status=not.in.(completed,canceled)&select=id&order=scheduled_day.asc.nullslast&limit=1`))[0];
        jobId = open ? open.id : null;
      }

      const phone = String(cus.phone || '').trim();
      let texted = false;
      if (phone) { try { texted = await sendSms(phone, text, 'customer', 'platform_thread_msg'); } catch (_) {} }
      const label = (isTech ? 'tech' : 'office') + (myName ? ':' + myName : '');
      const row = await db.insertRet('thread_message', {
        company_id: companyId, customer_id: cid, job_id: jobId,
        direction: 'out', channel: 'sms', sender: label, body: text,
      });
      // A write that returns nothing never happened — never report it as sent.
      if (!row) return json(200, { ok: false, error: 'not_logged', texted });
      return json(200, { ok: true, texted, no_phone: !phone, message: row });
    }

    // ── search: find anyone to start a conversation with, job or no job. ──
    // Search WHO and WHAT WAS SAID. Two gaps the office hit on day one: the inbox could
    // only be searched by name or phone, so a conversation could only be found if you
    // already knew whose it was; and nothing looked at the address, so there was no way to
    // pull up an area. The office searches by where the work is at least as often as by
    // who it's for, so both now match.
    if (doo === 'search') {
      const term = String(p.q || '').trim();
      if (term.length < 2) return json(200, { ok: true, customers: [], messages: [], total: 0 });
      // Strip the characters that would break out of a PostgREST or=() list, then encode
      // what's left so a two-word place ("Mount Juliet") survives the URL.
      const safe = term.replace(/[(),*%]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!safe) return json(200, { ok: true, customers: [], messages: [], total: 0 });
      const pat = encodeURIComponent(safe);
      const digits = safe.replace(/\D/g, '');
      const lim = Math.min(Math.max(parseInt(p.limit, 10) || 200, 25), 500);

      const ors = [
        `first_name.ilike.*${pat}*`, `last_name.ilike.*${pat}*`,
        `address.ilike.*${pat}*`, `city.ilike.*${pat}*`,
        `state.ilike.*${pat}*`, `zip.ilike.*${pat}*`,
        `email.ilike.*${pat}*`,
      ];
      if (digits.length >= 4) ors.push(`phone.ilike.*${digits}*`);

      // A person's name is split across two columns, so "Cornell Jones" matched NEITHER -
      // not first_name, not last_name - and the office got nothing back for the name printed
      // on the job. They fell back to phone numbers and work-order numbers, which is a
      // worse way to find a human. (Danielle, 2026-09-10.)
      // Match the words independently, in either order, and also let any single word hit a
      // name on its own so "Jones" still finds every Jones.
      const words = safe.split(' ').filter((w) => w.length >= 2).slice(0, 4);
      if (words.length > 1) {
        const a = encodeURIComponent(words[0]);
        const b = encodeURIComponent(words[words.length - 1]);
        ors.push(`and(first_name.ilike.*${a}*,last_name.ilike.*${b}*)`);
        ors.push(`and(first_name.ilike.*${b}*,last_name.ilike.*${a}*)`);
        for (const w of words) {
          const e = encodeURIComponent(w);
          ors.push(`first_name.ilike.*${e}*`, `last_name.ilike.*${e}*`, `city.ilike.*${e}*`);
        }
      }

      const SEL = 'id,first_name,last_name,phone,city,address,zip';
      const [people, hits] = await Promise.all([
        db.get(`customer?company_id=eq.${companyId}&or=(${ors.join(',')})&select=${SEL}&order=last_name.asc&limit=${lim}`),
        db.get(`thread_message?company_id=eq.${companyId}&customer_id=not.is.null&body=ilike.*${pat}*` +
               `&select=customer_id,body,created_at,direction&order=created_at.desc&limit=200`),
      ]);

      // One message per person — the most recent one that matched, which is the line the
      // office is actually looking for.
      const best = new Map();
      for (const m of (hits || [])) if (m.customer_id && !best.has(m.customer_id)) best.set(m.customer_id, m);

      // Anyone whose TEXT matched but whose details didn't still has to be reachable.
      const known = new Map((people || []).map((c) => [c.id, c]));
      const missing = [...best.keys()].filter((id) => !known.has(id)).slice(0, 200);
      if (missing.length) {
        const extra = await db.get(`customer?id=in.(${missing.join(',')})&company_id=eq.${companyId}&select=${SEL}&limit=200`);
        for (const c of (extra || [])) known.set(c.id, c);
      }

      const shape = (c) => ({ ...c, name: nameOf(c) || 'Customer' });
      const messages = [...best.entries()]
        .filter(([id]) => known.has(id))                        // company scope, enforced in code
        .map(([id, m]) => ({
          ...shape(known.get(id)),
          snippet: String(m.body || '').slice(0, 160),
          at: m.created_at,
          direction: m.direction,
        }));
      const msgIds = new Set(messages.map((m) => m.id));
      const customers = (people || []).map(shape).filter((c) => !msgIds.has(c.id));

      return json(200, { ok: true, customers, messages, total: customers.length + messages.length });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
