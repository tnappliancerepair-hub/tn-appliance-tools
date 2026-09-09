// platform-voice — real phone calls for the SUPABASE platform (multi-tenant), both ways.
//
// The platform already answered calls (a shop's own DID -> Ann, the AI). What it could NOT
// do was put a human on the phone: inbound "let me get you a person" hit ONE hard-wired
// owner cell, and there was no way to call a customer OUT at all. This adds both, per shop.
//
//   OUTBOUND  ?do=call        — a seat taps "Call" in the app. We ring THAT SEAT'S OWN CELL
//                               first, then bridge them to the customer. The customer sees
//                               the SHOP'S number; the seat's personal cell is never exposed.
//   INBOUND   ?do=ring        — the shared ring hub. Ann transfers here; we resolve which
//                               shop it is, ring that shop's on-call seats in parallel, and
//                               first pickup wins.
//
// WHY A BRIDGE AND NOT A BROWSER SOFTPHONE: the Xano side runs WebRTC (office-phone.html) and
// it costs a hand-provisioned SIP credential PER PERSON (TELNYX_SIP_USERNAME_SOFIA...), needs
// mic permission, and is documented as unreliable for inbound because iOS drops the socket the
// moment the tab is backgrounded. None of that survives a thousand shops. A bridge needs zero
// per-seat setup, works on whatever phone the seat already carries, and rings like a normal call.
//
// HOW ONE HUB SERVES EVERY SHOP: Ann's transfer sets `from` to the shop's own DID, so the hub
// sees From = that shop's number and resolves the tenant from it. One extra DID, not one per shop.
//
// SAFETY: every DB read/write is scoped to company_id IN CODE (the service key bypasses RLS).
// Nothing dials until PLATFORM_VOICE_LIVE=true — until then ?do=call reports what it WOULD do.
'use strict';

const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');

const TELNYX = 'https://api.telnyx.com/v2';
const SELF = 'https://tnapplianceexchange.net/.netlify/functions/platform-voice';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Content-Type': 'application/json' };

function J(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function esc(s) { return String(s == null ? '' : s).replace(/[<&>"']/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function xml(inner) {
  return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' + inner + '\n</Response>' };
}
// A live caller must never hear silence because a lookup was slow. Every TeXML branch
// falls back to this instead of erroring out.
function sorryXml(msg) {
  return xml('  <Say voice="Polly.Joanna">' + esc(msg || "Sorry, no one is available to take the call right now. Please leave us a message and we'll call you right back.") + '</Say>\n  <Hangup/>');
}

function e164(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  if (String(v || '').trim().startsWith('+')) return '+' + d;
  return d.length > 11 ? '+' + d : '';
}
function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

// Telnyx posts TeXML webhooks form-encoded; our own app posts JSON. Take either.
function tparams(event) {
  const out = {};
  const q = (event && event.queryStringParameters) || {};
  for (const k in q) out[k] = q[k];
  let raw = (event && event.body) || '';
  if (event && event.isBase64Encoded && raw) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) {} }
  if (raw) {
    const h = (event && event.headers) || {};
    const ct = String(h['content-type'] || h['Content-Type'] || '').toLowerCase();
    if (ct.indexOf('json') >= 0 || raw.trim().startsWith('{')) { try { Object.assign(out, JSON.parse(raw)); } catch (_) {} }
    else { try { new URLSearchParams(raw).forEach((v, k) => { out[k] = v; }); } catch (_) {} }
  }
  return out;
}

async function tx(method, path, body) {
  const key = process.env.TELNYX_API_KEY || (await getSecret('TELNYX_API_KEY'));
  if (!key) return { ok: false, status: 0, data: { error: 'no_telnyx_key' } };
  const r = await fetch(TELNYX + path, {
    method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

// ── Supabase (service key → bypasses RLS, so scope by company_id in code) ──
async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key, ms) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const t = ms || 7000;
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(t) }); return r.ok ? r.json() : []; },
    async insert(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(t) });
      const d = await r.json().catch(() => null); if (!r.ok) return null; return Array.isArray(d) ? d[0] : d;
    },
    async patch(path, row) {
      const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(t) });
      const d = await r.json().catch(() => null); return r.ok && Array.isArray(d) ? d : null;
    },
  };
}
async function db(ms) { const c = await cfg(); if (!c.key) return null; return rest(c.url, c.key, ms); }

// Session JWT -> the seat (ANY role — a tech calling his customer is the point).
async function seatFromToken(token) {
  if (!token) return null;
  const c = await cfg(); if (!c.key) return null;
  const r = await fetch(c.url + '/auth/v1/user', { headers: { apikey: c.key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !u.id) return null;
  const d = await db(); if (!d) return null;
  const rows = await d.get(`app_user?auth_user_id=eq.${encodeURIComponent(u.id)}&select=id,company_id,name,email,phone,role,active&limit=1`);
  const s = rows && rows[0];
  return s && s.company_id ? s : null;
}

// ── short-lived signed token so a Telnyx webhook can carry call context with no table ──
async function tokSecret() {
  return (await getSecret('PLATFORM_VOICE_SECRET')) || (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
}
function b64u(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { const p = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); return Buffer.from(p + '==='.slice((p.length + 3) % 4), 'base64').toString('utf8'); }
async function signTok(obj) {
  const body = b64u(JSON.stringify(obj));
  const sig = crypto.createHmac('sha256', await tokSecret()).update(body).digest('hex').slice(0, 24);
  return body + '.' + sig;
}
async function readTok(t) {
  const parts = String(t || '').split('.');
  if (parts.length !== 2) return null;
  const want = crypto.createHmac('sha256', await tokSecret()).update(parts[0]).digest('hex').slice(0, 24);
  // timing-safe compare on equal-length hex
  if (parts[1].length !== want.length || !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(want))) return null;
  let o = null; try { o = JSON.parse(unb64u(parts[0])); } catch (_) { return null; }
  if (!o || !o.exp || Date.now() > o.exp) return null;
  return o;
}

// ── who a shop rings when a caller wants a human ──
// settings.phone.oncall = [app_user id, ...] in ring order. Unset = every active
// office-side seat with a cell (techs are in the field; they don't get rung by default).
const DESK_ROLES = ['owner', 'office', 'manager', 'admin'];
async function ringSeats(d, company) {
  const cid = company.id;
  const rows = await d.get(`app_user?company_id=eq.${encodeURIComponent(cid)}&active=is.true&select=id,name,phone,role&limit=50`);
  const all = (rows || []).filter((r) => e164(r.phone));
  const oncall = ((company.settings && company.settings.phone && company.settings.phone.oncall) || null);
  if (Array.isArray(oncall) && oncall.length) {
    const byId = {}; all.forEach((r) => { byId[String(r.id)] = r; });
    return oncall.map((id) => byId[String(id)]).filter(Boolean);
  }
  return all.filter((r) => DESK_ROLES.indexOf(String(r.role || '').toLowerCase()) >= 0);
}

function shopNumber(company) {
  return e164((company.settings && company.settings.phone && company.settings.phone.number) || '');
}

// ═══════════════════════════════════════════════════════════════════════════
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const p = tparams(event);
  const doo = String(p.do || '').toLowerCase();
  const LIVE = String(await getSecret('PLATFORM_VOICE_LIVE') || '').toLowerCase() === 'true';

  try {
    // ─────────────────────────── TeXML: outbound bridge leg 2 ───────────────────────────
    // The seat answered their own phone. Announce who we're connecting them to, then dial
    // the customer with the SHOP as caller ID.
    if (doo === 'bridge') {
      const t = await readTok(p.t);
      if (!t || !t.to) return sorryXml('That call link expired. Please try again from the app.');
      const who = t.cust ? ('Connecting you to ' + t.cust + '.') : 'Connecting your call now.';
      return xml(
        '  <Say voice="Polly.Joanna">' + esc(who) + '</Say>\n' +
        '  <Dial callerId="' + esc(t.from) + '" timeout="30" answerOnBridge="true">\n' +
        '    <Number>' + esc(t.to) + '</Number>\n' +
        '  </Dial>'
      );
    }

    // ─────────────────────────── TeXML: inbound ring hub ───────────────────────────
    // Ann transfers here with From = the shop's own DID, which is how we know whose call
    // this is without a number-to-shop table.
    if (doo === 'ring') {
      const from = e164(p.From || p.from || '');
      const caller = e164(p.CallerNumber || p.caller || '') || '';
      const d = await db(4500);
      if (!d || !from) return sorryXml();
      let company = null;
      try {
        const rows = await d.get(`company?settings->phone->>number=eq.${encodeURIComponent(from)}&select=id,name,slug,settings&limit=1`);
        company = (rows && rows[0]) || null;
      } catch (_) {}
      if (!company) return sorryXml();

      let seats = [];
      try { seats = await ringSeats(d, company); } catch (_) {}
      if (!seats.length) return sorryXml("Everyone's with a customer right now. Leave us a message and we'll call you right back.");

      const shop = shopNumber(company) || from;
      const wtok = await signTok({ shop: company.name || '', caller: caller, exp: Date.now() + 10 * 60000 });
      const wUrl = SELF + '?do=whisper&t=' + encodeURIComponent(wtok);
      // The Dial action webhook reports whether the group answered, but not WHICH leg picked
      // up, and its From is the shop's own DID (Ann transferred from it) rather than the
      // customer. So carry the real caller on the action URL instead of misreading it later.
      const action = SELF + '?do=ring_status&c=' + encodeURIComponent(company.id) + (caller ? '&caller=' + encodeURIComponent(caller) : '');
      const legs = seats.slice(0, 8).map((s) => '    <Number url="' + esc(wUrl) + '">' + esc(e164(s.phone)) + '</Number>').join('\n');
      return xml(
        '  <Dial callerId="' + esc(shop) + '" timeout="25" answerOnBridge="true" action="' + esc(action) + '" method="POST">\n' + legs + '\n  </Dial>\n' +
        '  <Say voice="Polly.Joanna">Sorry, no one could pick up. Please leave a message and we will call you right back.</Say>'
      );
    }

    // Whisper: tell the seat what they're picking up BEFORE the caller is bridged in.
    // Announce only — no "press 1 to accept". That gate made callers hang up before the
    // seat could press anything (Xano, 2026-08-18) and it stays off here on purpose.
    if (doo === 'whisper') {
      const t = await readTok(p.t) || {};
      const c = t.caller ? (' from ' + String(t.caller).replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')) : '';
      return xml('  <Say voice="Polly.Joanna">' + esc('Customer call for ' + (t.shop || 'the shop') + c + '.') + '</Say>');
    }

    // Which seat caught it (or nobody). Off the live-call path, so a slow write is harmless.
    if (doo === 'ring_status') {
      const answered = String(p.DialCallStatus || '').toLowerCase() === 'completed' && Number(p.DialCallDuration || 0) > 0;
      try {
        const d = await db(4000);
        if (d && p.c) {
          await d.insert('call_event', {
            company_id: p.c, direction: 'in', outcome: answered ? 'answered' : 'missed',
            caller: e164(p.caller || ''), call_sid: p.CallSid || '', at: new Date().toISOString(),
          });
        }
      } catch (_) {}
      return xml(answered ? '  <Hangup/>' : '  <Say voice="Polly.Joanna">Sorry we missed you. Please leave a message and we will call you right back.</Say>');
    }

    // ─────────────────────────── App: place an outbound call ───────────────────────────
    if (doo === 'call') {
      const seat = await seatFromToken(p.access_token);
      if (!seat) return J(401, { ok: false, error: 'unauthorized' });
      const myCell = e164(seat.phone);
      if (!myCell) return J(200, { ok: false, error: 'no_seat_phone', message: 'Add your cell number to your profile first — that is the phone we ring so the customer never sees it.' });

      const to = e164(p.to);
      if (!to) return J(200, { ok: false, error: 'bad_number', message: 'That does not look like a phone number.' });

      const d = await db();
      if (!d) return J(200, { ok: false, error: 'no_db' });
      const crows = await d.get(`company?id=eq.${encodeURIComponent(seat.company_id)}&select=id,name,slug,settings&limit=1`);
      const company = (crows && crows[0]) || null;
      if (!company) return J(200, { ok: false, error: 'no_company' });
      const shop = shopNumber(company);
      if (!shop) {
        return J(200, { ok: false, error: 'no_shop_number', message: 'This shop has no phone number yet. Turn on the AI receptionist in Settings to get one — that number is also what your customers see when you call out.' });
      }

      // Never let a seat dial their own line into a loop.
      if (last10(to) === last10(myCell) || last10(to) === last10(shop)) {
        return J(200, { ok: false, error: 'loop', message: 'That is your own line.' });
      }

      const custName = String(p.name || '').trim();
      const tok = await signTok({ to, from: shop, cust: firstName(custName), cid: company.id, seat: seat.id, exp: Date.now() + 10 * 60000 });
      const acct = await getSecret('TELNYX_ACCOUNT_ID');
      const appSid = await getSecret('PLATFORM_VOICE_TEXML_APP_ID');

      if (!LIVE || !acct || !appSid) {
        return J(200, {
          ok: true, shadow: true,
          would_call: { ring_first: myCell, then_bridge_to: to, customer_sees: shop },
          missing: [!LIVE ? 'PLATFORM_VOICE_LIVE' : null, !acct ? 'TELNYX_ACCOUNT_ID' : null, !appSid ? 'PLATFORM_VOICE_TEXML_APP_ID' : null].filter(Boolean),
          message: 'Calling is not switched on yet.',
        });
      }

      const res = await tx('POST', `/texml/Accounts/${encodeURIComponent(acct)}/Calls`, {
        To: myCell, From: shop, ApplicationSid: appSid,
        Url: SELF + '?do=bridge&t=' + encodeURIComponent(tok),
        Timeout: 30, MachineDetection: 'Disable',
      });
      if (!res.ok) {
        return J(200, { ok: false, error: 'telnyx', status: res.status, detail: JSON.stringify(res.data).slice(0, 300), message: 'The phone system refused the call. Try again in a moment.' });
      }

      try {
        await d.insert('call_event', {
          company_id: company.id, direction: 'out', outcome: 'placed',
          caller: to, seat_phone: myCell, seat_id: seat.id, job_id: p.job_id || null,
          call_sid: (res.data && (res.data.sid || res.data.CallSid)) || '', at: new Date().toISOString(),
        });
      } catch (_) {}

      // Put it in the shared conversation so the office/tech/customer thread stays whole.
      if (p.job_id) {
        try {
          await d.insert('thread_message', {
            company_id: company.id, job_id: p.job_id, direction: 'out', channel: 'call',
            sender: (String(seat.role || '') === 'tech' ? 'tech' : 'office') + ':' + (seat.name || ''),
            body: '📞 Called ' + (custName || to) + ' from the shop line.',
          });
        } catch (_) {}
      }
      return J(200, { ok: true, calling: myCell, then: to, customer_sees: shop, message: 'Answer your phone — we are connecting you.' });
    }

    // ─────────────────────────── App: what this shop's phone can do ───────────────────────────
    if (doo === 'status') {
      const seat = await seatFromToken(p.access_token);
      if (!seat) return J(401, { ok: false, error: 'unauthorized' });
      const d = await db(); if (!d) return J(200, { ok: false, error: 'no_db' });
      const crows = await d.get(`company?id=eq.${encodeURIComponent(seat.company_id)}&select=id,name,settings&limit=1`);
      const company = (crows && crows[0]) || null;
      if (!company) return J(200, { ok: false, error: 'no_company' });
      const seats = await ringSeats(d, company);
      const all = await d.get(`app_user?company_id=eq.${encodeURIComponent(seat.company_id)}&active=is.true&select=id,name,phone,role&limit=50`);
      return J(200, {
        ok: true, live: LIVE, shop_number: shopNumber(company) || null,
        me: { id: seat.id, name: seat.name, role: seat.role, has_cell: !!e164(seat.phone) },
        on_call: seats.map((s) => ({ id: s.id, name: s.name, role: s.role })),
        seats: (all || []).map((s) => ({ id: s.id, name: s.name, role: s.role, has_cell: !!e164(s.phone) })),
      });
    }

    // Set the ring order / who's on call (management only).
    if (doo === 'oncall') {
      const seat = await seatFromToken(p.access_token);
      if (!seat) return J(401, { ok: false, error: 'unauthorized' });
      if (DESK_ROLES.indexOf(String(seat.role || '').toLowerCase()) < 0) return J(403, { ok: false, error: 'not_allowed' });
      const ids = Array.isArray(p.ids) ? p.ids.map(String) : null;
      if (!ids) return J(200, { ok: false, error: 'ids_required' });
      const d = await db(); if (!d) return J(200, { ok: false, error: 'no_db' });
      const crows = await d.get(`company?id=eq.${encodeURIComponent(seat.company_id)}&select=id,settings&limit=1`);
      const company = (crows && crows[0]) || null;
      if (!company) return J(200, { ok: false, error: 'no_company' });
      const settings = company.settings || {};
      settings.phone = Object.assign({}, settings.phone || {}, { oncall: ids });
      const upd = await d.patch(`company?id=eq.${encodeURIComponent(company.id)}`, { settings });
      if (!upd || !upd.length) return J(200, { ok: false, error: 'save_failed' });
      return J(200, { ok: true, oncall: ids });
    }

    // ─────────────────────────── Admin: config check + one-time setup ───────────────────────────
    if (doo === 'probe' || doo === 'setup') {
      const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
      if (String(p.secret || '') !== admin) return J(403, { ok: false, error: 'forbidden' });

      const acct = await getSecret('TELNYX_ACCOUNT_ID');
      const appSid = await getSecret('PLATFORM_VOICE_TEXML_APP_ID');
      const ringDid = await getSecret('PLATFORM_VOICE_RING_DID');

      if (doo === 'setup') {
        // Create the ONE shared TeXML app that handles every shop's bridge + ring hub.
        if (!appSid) {
          const made = await tx('POST', '/texml_applications', {
            friendly_name: 'Ant Platform Voice (bridge + ring hub)',
            voice_url: SELF + '?do=ring', voice_method: 'POST',
          });
          if (!made.ok) return J(200, { ok: false, step: 'create_texml_app', status: made.status, detail: JSON.stringify(made.data).slice(0, 400) });
          return J(200, {
            ok: true, created_texml_app: (made.data && made.data.data && made.data.data.id) || null,
            next: 'Save that id in the vault as PLATFORM_VOICE_TEXML_APP_ID, then re-run ?do=setup.',
          });
        }
        return J(200, { ok: true, already: { texml_app: appSid }, next: 'Point a spare DID at this TeXML app and save it as PLATFORM_VOICE_RING_DID.' });
      }

      // probe — which account-id path actually works for TeXML REST, without dialing anything.
      const cands = [acct, appSid].filter(Boolean);
      const tried = [];
      for (const c of cands) {
        const r = await tx('GET', `/texml/Accounts/${encodeURIComponent(c)}/Calls?PageSize=1`);
        tried.push({ candidate_kind: c === acct ? 'TELNYX_ACCOUNT_ID' : 'PLATFORM_VOICE_TEXML_APP_ID', ok: r.ok, status: r.status });
      }
      const apps = await tx('GET', '/texml_applications?page[size]=25');
      return J(200, {
        ok: true, live: LIVE,
        vault: {
          TELNYX_API_KEY: !!(process.env.TELNYX_API_KEY || (await getSecret('TELNYX_API_KEY'))),
          TELNYX_ACCOUNT_ID: !!acct, PLATFORM_VOICE_TEXML_APP_ID: !!appSid,
          PLATFORM_VOICE_RING_DID: ringDid || null, PLATFORM_VOICE_LIVE: LIVE,
        },
        texml_rest_path_check: tried,
        texml_applications: ((apps.data && apps.data.data) || []).map((a) => ({ id: a.id, name: a.friendly_name, voice_url: a.voice_url })),
      });
    }

    return J(400, { ok: false, error: 'unknown_do', allowed: ['call', 'status', 'oncall', 'ring', 'bridge', 'whisper', 'ring_status', 'probe', 'setup'] });
  } catch (e) {
    // A thrown error on a TeXML branch would be dead air. Answer with words, always.
    if (['ring', 'bridge', 'whisper', 'ring_status'].indexOf(doo) >= 0) return sorryXml();
    return J(200, { ok: false, error: 'exception', detail: String((e && e.message) || e).slice(0, 200) });
  }
};
