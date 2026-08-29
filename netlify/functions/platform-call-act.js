// platform-call-act — the "close the loop" action router for a shop's Ann (multi-tenant).
//
// The read brain (platform-call-brain) tells Ann what's true; THIS lets her ACT on it during
// a call, all reused from existing platform primitives, all company-scoped (shop baked into
// the tool URL → company_id), all landing on THAT shop's board:
//
//   POST ?do=request_day  &slug=&k=  { phone|claim|name, day, win?, note? }  — book/confirm a DAY
//        -> records a schedule_offer (customer direction, low-promise window) the office locks in.
//   POST ?do=callback     &slug=&k=  { phone, name?, note? }                 — never lose a caller
//        -> a thread_message on their job (or a fresh lead if unknown) + best-effort owner text.
//   POST ?do=send_link    &slug=&k=  { phone, kind? }                        — text the portal/intake link
//        -> finds/mints the customer's portal_grant and texts them /p/<token> (or /i/<token>).
//
// Transfer to a human is NOT here — it's the Telnyx assistant's NATIVE transfer tool (wired in
// the provisioning builders with the shop's cell), gated to business hours in Ann's instructions.
//
// Gate: real slugs require ?k=<TELNYX_TOOL_SECRET>; 'demo' is open. Every write is best-effort
// and returns a short spoken `say` line for Ann; a failure never throws into the call.
'use strict';

const { getSecret } = require('./_lib/secrets');
let sms = null; try { sms = require('./_lib/sms'); } catch (_) {}
let platformDb = null; try { platformDb = require('./_lib/platform-db'); } catch (_) {}

const SITE = 'https://tnapplianceexchange.net';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(7000) }); return r.ok ? r.json() : []; },
    async insert(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(7000) });
      const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && (d.message || d.hint)) || ('insert ' + table)); return Array.isArray(d) ? d[0] : d;
    },
    async rpc(fn, body) { const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(7000) }); return r.ok ? r.json() : null; },
  };
}

// spoken day -> ISO date (America/Chicago). Accepts an ISO date, today/tomorrow, or a weekday
// name ("thursday"/"thu") -> the NEXT occurrence. '' when it can't be resolved.
function resolveDay(spoken) {
  const s = String(spoken || '').trim().toLowerCase();
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
  const now = new Date();
  const ctYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
  const addDays = (n) => ctYmd(new Date(now.getTime() + n * 86400000));
  if (s === 'today') return ctYmd(now);
  if (s === 'tomorrow') return addDays(1);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = days.findIndex((d) => s.includes(d.slice(0, 3)));
  if (idx >= 0) {
    const todayIdx = new Date(ctYmd(now) + 'T12:00:00').getDay();
    let delta = (idx - todayIdx + 7) % 7; if (delta === 0) delta = 7; // next, not today
    return addDays(delta);
  }
  return '';
}
function normWin(w) { const s = String(w || '').toLowerCase(); if (/morning|^am\b|a\.m/.test(s)) return 'am'; if (/after|even|^pm\b|p\.m/.test(s)) return 'pm'; return 'any'; }
function dayLabel(iso) { if (!/^\d{4}-\d\d-\d\d$/.test(String(iso || ''))) return String(iso || ''); return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Chicago' }); }
const winWord = { am: ' in the morning', pm: ' in the afternoon', any: '' };

async function ownerPhone(db, companyId) {
  try { const r = await db.get(`app_user?company_id=eq.${companyId}&role=eq.owner&select=phone&limit=1`); return (r && r[0] && r[0].phone) || ''; } catch (_) { return ''; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) {}
  const g = (k) => (p[k] != null ? p[k] : q[k]);
  const doo = String(g('do') || '');
  const slug = String(g('slug') || '').toLowerCase().trim();
  if (!slug) return json(400, { ok: false, error: 'no_slug' });
  if (slug !== 'demo') { const tk = await getSecret('TELNYX_TOOL_SECRET'); if (tk && g('k') !== tk) return json(403, { ok: false, error: 'forbidden' }); }

  const { url, key } = await cfg();
  if (!key) return json(200, { ok: false, error: 'platform_not_configured', say: "Let me take your details and have the office follow up." });
  const db = rest(url, key);

  // resolve company + the caller's job (best-effort)
  let co, facts = null;
  try {
    const cr = await db.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name&limit=1`);
    co = cr && cr[0];
  } catch (_) {}
  if (!co) return json(200, { ok: false, error: 'unknown_shop', say: "Let me take your details and have the office follow up." });
  const phone = String(g('phone') || '').trim();
  try {
    facts = await db.rpc('platform_call_lookup', { p_company_id: co.id, p_phone: phone || null, p_claim: g('claim') ? String(g('claim')) : null, p_name: g('name') ? String(g('name')) : null });
  } catch (_) { facts = null; }
  const cust = facts && facts.customer;
  const job = facts && facts.job;

  try {
    // ── BOOK / CONFIRM A DAY ────────────────────────────────────────────────────────────
    if (doo === 'request_day') {
      const iso = resolveDay(g('day'));
      if (!iso) return json(200, { ok: false, say: "What day works best for you?" });
      const win = normWin(g('win'));
      const note = String(g('note') || '').slice(0, 240) || null;
      const lbl = dayLabel(iso) + (winWord[win] || '');
      if (job && job.id && cust && cust.id) {
        await db.insert('schedule_offer', { company_id: co.id, job_id: job.id, customer_id: cust.id, direction: 'customer', proposed_day: iso, win, note, status: 'pending', created_by: 'ann' });
        try { await db.insert('thread_message', { company_id: co.id, customer_id: cust.id, job_id: job.id, direction: 'in', channel: 'call', sender: 'ann', body: `📅 Requested ${lbl}${note ? ' — ' + note : ''} (by phone)` }); } catch (_) {}
        return json(200, { ok: true, say: `Perfect — I've put in a request for ${lbl}. We don't lock exact clock times, but the office will confirm your day and text you.`, day: iso, win });
      }
      // no existing job — land it as a fresh lead carrying the requested day
      if (platformDb) {
        const r = await platformDb.createLeadJob({ slug, name: g('name') || (cust && (cust.first_name + ' ' + (cust.last_name || ''))) || '', phone, what: 'appointment request', detail: `Requested ${lbl}${note ? ' — ' + note : ''}`, source: 'ann_phone' });
        if (r && r.ok) return json(200, { ok: true, say: `Got it — I've started that for you and noted ${lbl}. The office will confirm your day and text you.`, job_id: r.job_id });
      }
      return json(200, { ok: true, say: `Got it — I've noted ${lbl} and the office will follow up to confirm.` });
    }

    // ── CAPTURE A CALLBACK (never lose a caller) ────────────────────────────────────────
    if (doo === 'callback') {
      const name = String(g('name') || (cust && cust.first_name) || '').trim();
      const note = String(g('note') || '').slice(0, 300);
      const cb = phone || (cust && cust.phone) || '';
      if (job && job.id && cust && cust.id) {
        await db.insert('thread_message', { company_id: co.id, customer_id: cust.id, job_id: job.id, direction: 'in', channel: 'call', sender: 'ann', body: `📞 CALLBACK for ${name || 'customer'}${note ? ' — ' + note : ''}${cb ? ' — call back ' + cb : ''}` });
        const op = await ownerPhone(db, co.id);
        if (op && sms) { try { await sms.sendSms(op, `📞 Callback: ${name || 'a customer'}${cb ? ' (' + cb + ')' : ''}${note ? ' — ' + note : ''} — on their ${job.unit_label || 'job'}.`, 'office', 'ann_callback'); } catch (_) {} }
        return json(200, { ok: true, say: `You got it${name ? ', ' + name : ''} — I've flagged this for the office and they'll call you right back.` });
      }
      // unknown caller → a fresh lead card (also texts them the intake link) + owner alert
      if (platformDb) {
        const r = await platformDb.createLeadJob({ slug, name, phone: cb, what: 'callback request', detail: note || 'asked for a callback', source: 'ann_phone' });
        if (r && r.ok) {
          const op = await ownerPhone(db, co.id);
          if (op && sms) { try { await sms.sendSms(op, `📞 Callback request: ${name || 'a caller'}${cb ? ' (' + cb + ')' : ''}${note ? ' — ' + note : ''}.`, 'office', 'ann_callback'); } catch (_) {} }
          return json(200, { ok: true, say: `Absolutely${name ? ', ' + name : ''} — I've got your details and the office will call you right back.` });
        }
      }
      return json(200, { ok: false, say: "I've noted that and the office will reach out." });
    }

    // ── TEXT THE PORTAL / INTAKE LINK ───────────────────────────────────────────────────
    if (doo === 'send_link') {
      const kind = /portal/i.test(String(g('kind') || '')) ? 'portal' : 'intake';
      const cb = phone || (cust && cust.phone) || '';
      if (job && job.id && cust && cust.id) {
        let token = '';
        try { const gs = await db.get(`portal_grant?job_id=eq.${job.id}&select=token&order=created_at.desc&limit=1`); token = gs && gs[0] && gs[0].token; } catch (_) {}
        if (!token) { try { const gg = await db.insert('portal_grant', { company_id: co.id, customer_id: cust.id, job_id: job.id }); token = gg && gg.token; } catch (_) {} }
        if (token && cb && sms) {
          const link = `${SITE}/${kind === 'portal' ? 'p' : 'i'}/${token}`;
          const body = kind === 'portal'
            ? `${co.name}: track your repair + message us here — ${link}`
            : `${co.name}: tap to send a quick video + a photo of the model sticker so we can get you set up — ${link}`;
          try { await sms.sendFrom588(cb, body, 'ann_' + kind + '_link'); } catch (_) {}
          return json(200, { ok: true, say: `I just texted you the link — go ahead and tap it whenever you're ready.`, link });
        }
      }
      // unknown caller → createLeadJob already texts the intake link
      if (platformDb && cb) {
        const r = await platformDb.createLeadJob({ slug, name: g('name') || '', phone: cb, what: 'phone lead', detail: 'sent intake link', source: 'ann_phone' });
        if (r && r.ok) return json(200, { ok: true, say: `I just texted you a link to get started — send us a quick video and a photo of the model sticker.`, job_id: r.job_id });
      }
      return json(200, { ok: false, say: "What's the best mobile number to text the link to?" });
    }

    return json(400, { ok: false, error: 'unknown do: ' + doo });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 120), say: "Let me take your details and have the office follow up." });
  }
};
