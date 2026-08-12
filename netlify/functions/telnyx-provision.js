// telnyx-provision — create separate SIP logins for the Office Phone so Teddy and
// Danielle don't share one credential (sharing caused the WebSocket thrash that
// dropped calls). Creates a Telnyx "telephony credential" under the office-phone
// Credential Connection and stores its sip_username/password straight into the
// vault (per person), so the token endpoint can hand each device its own login.
//
// Both credentials live under the SAME connection, so the office DID forks the
// call to every registered device — i.e. it rings Teddy AND Danielle at once.
//
//   ...&action=create&who=danielle     -> makes Danielle's login, vaults it
//   ...&action=create&who=teddy        -> (re)makes Teddy's login, vaults it
//   ...&action=list                    -> list credentials on the connection
// Guarded by the vapi-admin secret. Needs TELNYX_API_KEY in the vault.
'use strict';

const { getSecret, setSecret } = require('./_lib/secrets');
const TELNYX = 'https://api.telnyx.com/v2';
const SITE = 'https://tnapplianceexchange.net';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const CONNECTION_ID_DEFAULT = '2988827155447678681'; // "Ant office phone" credential connection
const OFFICE_DID = '+16155889591';                    // the office-phone number Ant transfers to

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };

  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, error: 'TELNYX_API_KEY not in vault — add it in admin-secrets.html' });
  const connId = (await getSecret('TELNYX_OFFICE_CONNECTION_ID')) || CONNECTION_ID_DEFAULT;
  const action = q.action || 'list';
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  try {
    // Read-only: A2P 10DLC registration status per number. An unregistered long code
    // has its texts silently dropped by US carriers — so this shows which of our lines
    // are actually APPROVED to text customers (Teddy 2026-07-16: "we have approved
    // numbers, we need to use them — let's check").
    // Cost visibility (Teddy 2026-08-11: "we're being charged 2x/day for Telnyx —
    // are we doing something wrong / can we cut costs?"). Read-only spend picture.
    // &action=balance  -> current balance + available credit (auto-recharge tops this up)
    // &action=numbers  -> how many DIDs we rent (monthly recurring)
    // &action=spend    -> voice + messaging usage cost over the last N days (&days=)
    // &action=ai  -> read-only probe of the Telnyx Voice AI Assistants API, to confirm
    // our key can create/manage assistants (so the shadow AI can be built via API, no
    // portal). Teddy 2026-08-12. Tries the current + legacy paths; reports which works.
    if (action === 'ai') {
      const tryGet = async (path) => { try { const r = await fetch(`${TELNYX}${path}`, { headers: H, signal: AbortSignal.timeout(12000) }); const d = await r.json().catch(() => ({})); const arr = Array.isArray(d && d.data) ? d.data : (Array.isArray(d) ? d : null); return { path, status: r.status, ok: r.ok, count: arr ? arr.length : null, sample: arr && arr[0] ? Object.keys(arr[0]).slice(0, 12) : (d && d.errors ? d.errors : Object.keys(d || {}).slice(0, 8)) }; } catch (e) { return { path, status: 0, ok: false, error: String((e && e.message) || e).slice(0, 80) }; } };
      const probes = [];
      for (const p of ['/ai/assistants', '/ai/models']) probes.push(await tryGet(p));
      const works = probes.find((x) => x.ok);
      // Which LLMs? Filter to Claude/Anthropic so we can match the brain.
      let claude = null;
      try { const r = await fetch(`${TELNYX}/ai/models`, { headers: H, signal: AbortSignal.timeout(12000) }); const d = await r.json().catch(() => ({})); const m = Array.isArray(d && d.data) ? d.data : []; claude = m.map((x) => x.id).filter((id) => /claude|anthropic|sonnet|haiku|opus/i.test(String(id))); if (!claude.length) claude = { none_matched: true, all_ids: m.map((x) => x.id).slice(0, 30) }; } catch (e) { claude = { error: String((e && e.message) || e).slice(0, 80) }; }
      // Which TTS voices/providers? Look for Cartesia / Brooke to match the current voice.
      let voices = {};
      for (const vp of ['/text-to-speech/voices', '/ai/voices']) { try { const r = await fetch(`${TELNYX}${vp}`, { headers: H, signal: AbortSignal.timeout(12000) }); const d = await r.json().catch(() => ({})); const arr = Array.isArray(d && d.data) ? d.data : (Array.isArray(d) ? d : []); if (r.ok && arr.length) { const provs = {}; arr.forEach((v) => { const p = v.provider || (String(v.id || v.name || '').split('.')[0]) || '?'; provs[p] = (provs[p] || 0) + 1; }); const cart = arr.filter((v) => /cartesia|brooke/i.test(JSON.stringify(v))).slice(0, 5); voices[vp] = { status: r.status, total: arr.length, providers: provs, cartesia_or_brooke: cart }; } else { voices[vp] = { status: r.status, note: (d && d.errors) || 'no rows' }; } } catch (e) { voices[vp] = { error: String((e && e.message) || e).slice(0, 80) }; } }
      return json(200, { ok: !!works, can_manage_via_api: !!works, working_path: works ? works.path : null, claude_models: claude, tts_voices: voices, probes });
    }

    if (action === 'balance') {
      const r = await fetch(`${TELNYX}/balance`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      return json(200, { ok: r.ok, status: r.status, balance: (d && d.data) || d });
    }

    if (action === 'numbers') {
      let page = 1, all = [];
      for (let i = 0; i < 8; i++) {
        const r = await fetch(`${TELNYX}/phone_numbers?page[size]=250&page[number]=${page}`, { headers: H, signal: AbortSignal.timeout(12000) });
        const d = await r.json().catch(() => ({}));
        const rows = Array.isArray(d && d.data) ? d.data : [];
        all = all.concat(rows);
        const meta = d && d.meta;
        if (!rows.length || (meta && meta.total_pages && page >= meta.total_pages)) break;
        page++;
      }
      const byType = {};
      for (const n of all) { const k = (n.phone_number_type || n.number_type || 'unknown'); byType[k] = (byType[k] || 0) + 1; }
      const messagingEnabled = all.filter((n) => n.messaging_profile_id || (n.features && (n.features.sms || (Array.isArray(n.features) && n.features.includes('sms'))))).length;
      return json(200, {
        ok: true, total_numbers: all.length, by_type: byType, messaging_enabled: messagingEnabled,
        note: 'each DID is a small monthly rental; messaging-enabled + 10DLC numbers may carry extra monthly fees',
        sample: all.slice(0, 8).map((n) => ({ number: n.phone_number, type: n.phone_number_type || n.number_type, status: n.status, messaging: !!n.messaging_profile_id })),
      });
    }

    if (action === 'spend') {
      const nowMs = Date.now();
      const num = (x, keys) => { for (const k of keys) { const v = parseFloat(x[k]); if (!isNaN(v)) return v; } return 0; };
      const ts = (x) => { for (const k of ['created_at', 'started_at', 'sent_at', 'occurred_at']) { if (x[k]) { const t = Date.parse(x[k]); if (!isNaN(t)) return t; } } return 0; };
      // Unfiltered probe: what record types does Telnyx actually bill us for?
      if (q.types === '1') {
        const r = await fetch(`${TELNYX}/detail_records?page[size]=250&sort=-created_at`, { headers: H, signal: AbortSignal.timeout(15000) });
        const d = await r.json().catch(() => ({}));
        const rows = Array.isArray(d && d.data) ? d.data : [];
        const byType = {}; for (const x of rows) { const k = x.record_type || 'unknown'; byType[k] = (byType[k] || 0) + 1; }
        return json(200, { ok: r.ok, status: r.status, pulled: rows.length, by_record_type: byType, first: rows[0] || null });
      }
      const cutoff = nowMs - 30 * 86400000; // only need up to 30d for buckets
      const pull = async (recordType) => {
        let all = [], pages = (q.debug ? 1 : 12);
        for (let p = 1; p <= pages; p++) {
          try {
            const url = `${TELNYX}/detail_records?filter[record_type]=${recordType}&page[size]=250&page[number]=${p}&sort=-created_at`;
            const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(9000) });
            const d = await r.json().catch(() => ({}));
            const rows = Array.isArray(d && d.data) ? d.data : [];
            if (p === 1 && !rows.length) return { ok: r.ok, status: r.status, note: 'no rows', sample_keys: Object.keys(d || {}).slice(0, 10), body: JSON.stringify(d).slice(0, 200) };
            all = all.concat(rows);
            if (rows.length < 40) break; // Telnyx messaging pages cap ~50; stop when a short page arrives
            const lastT = ts(rows[rows.length - 1]);
            if (lastT && lastT < cutoff) break; // reached >30d old, stop paging
          } catch (e) { break; }
        }
        // bucket windows
        const wins = { d1: nowMs - 86400000, d7: nowMs - 7 * 86400000, d30: nowMs - 30 * 86400000 };
        const b = { d1: {}, d7: {}, d30: {}, all: {} };
        for (const kk of ['d1', 'd7', 'd30', 'all']) b[kk] = { count: 0, cost_usd: 0, minutes: 0, segments: 0 };
        for (const x of all) {
          const t = ts(x);
          const cost = num(x, ['cost', 'total_cost', 'rate']);
          const durSec = num(x, ['duration_seconds', 'duration_secs', 'billed_seconds', 'call_sec_duration']);
          const seg = num(x, ['parts', 'segment_count', 'number_of_segments']) || 1;
          for (const kk of ['d1', 'd7', 'd30', 'all']) {
            if (kk === 'all' || t >= wins[kk]) {
              b[kk].count += 1; b[kk].cost_usd += cost;
              b[kk].minutes += durSec / 60; b[kk].segments += seg;
            }
          }
        }
        for (const kk of ['d1', 'd7', 'd30', 'all']) { b[kk].cost_usd = Math.round(b[kk].cost_usd * 100) / 100; b[kk].minutes = Math.round(b[kk].minutes * 10) / 10; }
        const oldestT = all.length ? ts(all[all.length - 1]) : 0;
        // 24h breakdown: direction (inbound vs outbound) + by our from-number + by profile
        const d1cut = nowMs - 86400000;
        const dir = {}, byFrom = {}, byProfile = {};
        const dCost = {}, fCost = {};
        for (const x of all) {
          if (ts(x) < d1cut) continue;
          const dr = (x.direction || 'unknown'); const cost = num(x, ['cost', 'total_cost', 'rate']) + num(x, ['carrier_fee']);
          const from = x.cli || x.from || '?'; const prof = x.profile_name || '?';
          dir[dr] = (dir[dr] || 0) + 1; dCost[dr] = (dCost[dr] || 0) + cost;
          byFrom[from] = (byFrom[from] || 0) + 1; fCost[from] = (fCost[from] || 0) + cost;
          byProfile[prof] = (byProfile[prof] || 0) + 1;
        }
        const topFrom = Object.keys(byFrom).sort((a, c) => byFrom[c] - byFrom[a]).slice(0, 8)
          .map((k) => ({ from: k, count: byFrom[k], cost_usd: Math.round(fCost[k] * 100) / 100 }));
        const dirOut = {}; for (const k of Object.keys(dir)) dirOut[k] = { count: dir[k], cost_usd: Math.round((dCost[k] || 0) * 100) / 100 };
        return { ok: true, pulled: all.length, capped: all.length >= pages * 250, oldest_record: oldestT ? new Date(oldestT).toISOString().slice(0, 10) : null, windows: b, last24h_by_direction: dirOut, last24h_by_from: topFrom, last24h_by_profile: byProfile, sample_keys: all[0] ? Object.keys(all[0]) : [] };
      };
      const voice = await pull('voice');
      const messaging = await pull('messaging');
      return json(200, { ok: true, generated: new Date(nowMs).toISOString(), voice, messaging });
    }

    if (action === 'tendlc') {
      // Telnyx 10DLC endpoints return TCR-style bodies (rows under `records`), not `data`.
      const rows = (d) => (Array.isArray(d && d.records) ? d.records : (Array.isArray(d && d.data) ? d.data : (Array.isArray(d) ? d : [])));
      const get = async (path) => { try { const r = await fetch(`${TELNYX}${path}`, { headers: H, signal: AbortSignal.timeout(12000) }); const d = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, rows: rows(d) }; } catch (e) { return { ok: false, status: 0, rows: [] }; } };
      let brand = await get('/brand'); if (!brand.rows.length) { const b2 = await get('/10dlc/brand'); if (b2.rows.length) brand = b2; }
      let camp = await get('/campaign'); if (!camp.rows.length) { const c2 = await get('/campaigns'); if (c2.rows.length) camp = c2; }
      let pnc = await get('/phone_number_campaigns?page[size]=200'); if (!pnc.rows.length) { const p2 = await get('/messaging_profiles?page[size]=50'); }
      const campById = {};
      camp.rows.forEach((c) => { const id = c.campaignId || c.campaign_id || c.id || c.tcrCampaignId; if (id) campById[id] = c.status || c.campaignStatus || c.brandId && 'ACTIVE' || 'registered'; });
      const norm = (p) => { const dd = String(p || '').replace(/\D/g, ''); return dd.length === 10 ? '+1' + dd : (dd.length === 11 ? '+' + dd : '+' + dd); };
      const byNumber = {};
      pnc.rows.forEach((a) => { const ph = norm(a.phoneNumber || a.phone_number); const cid = a.campaignId || a.campaign_id || a.telnyxCampaignId || a.tcrCampaignId; if (ph) byNumber[ph] = { campaign_id: cid || null, status: (cid && campById[cid]) || a.status || 'assigned' }; });
      const WATCH = ['+16155889500', '+16152802949', '+16158578800', '+16157575500'];
      const verdict = WATCH.map((ph) => { const a = byNumber[ph]; return { number: ph, registered: !!a, campaign_id: (a && a.campaign_id) || null, campaign_status: (a && a.status) || 'NONE — not in a 10DLC campaign (texts get dropped)' }; });
      const brands = brand.rows.map((b) => ({ id: b.brandId || b.id, name: b.displayName || b.entityName || b.name, status: b.identityStatus || b.status }));
      const campaigns = camp.rows.map((c) => ({ id: c.campaignId || c.campaign_id || c.id, status: c.status || c.campaignStatus, useCase: c.useCase || c.usecase }));
      return json(200, { ok: true, brands, campaigns, pnc_count: pnc.rows.length, verdict, _paths: { brand: brand.status, campaign: camp.status, pnc: pnc.status } });
    }

    // Read-only: search Telnyx's AVAILABLE inventory for a fresh number to buy
    // (the shared human SMS line). Filters to SMS+voice capable in the area code,
    // then keeps only ones matching the ends-with pattern. Buys NOTHING.
    //   ...&action=searchnew&area=615&ends=00
    if (action === 'searchnew') {
      const area = (q.area || '615').replace(/\D/g, '');
      const ends = (q.ends || '00').replace(/\D/g, '');
      // Ask Telnyx directly for numbers ending in the pattern (rare in a random pull).
      const url = `${TELNYX}/available_phone_numbers?filter[national_destination_code]=${area}&filter[features][]=sms&filter[features][]=voice&filter[phone_number][ends_with]=${ends}&filter[limit]=30`;
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
      const d = await r.json().catch(() => ({}));
      const all = ((d && d.data) || []).map((x) => x.phone_number).filter(Boolean);
      const matches = all.filter((n) => String(n).endsWith(ends));
      return json(200, { ok: r.ok, area, ends, returned: all.length, ending_matches: matches.slice(0, 20), sample: all.slice(0, 6), error: r.ok ? undefined : d });
    }

    // Buy a specific available number + attach it to the CUSTOMER SMS profile so it
    // can text immediately. GATED: requires &confirm=yes so it never buys by accident.
    //   ...&action=buynew&number=%2B16155550000&confirm=yes
    if (action === 'buynew') {
      const number = String(q.number || '').trim();
      if (!number) return json(200, { ok: false, error: 'pass &number=+1XXXXXXXXXX' });
      if (q.confirm !== 'yes') return json(200, { ok: false, error: 'add &confirm=yes to actually purchase ' + number });
      const r = await fetch(`${TELNYX}/number_orders`, { method: 'POST', headers: H, body: JSON.stringify({ phone_numbers: [{ phone_number: number }] }), signal: AbortSignal.timeout(20000) });
      const d = await r.json().catch(() => ({}));
      return json(200, { ok: r.ok, number, order: r.ok ? { id: d.data && d.data.id, status: d.data && d.data.status } : undefined, error: r.ok ? undefined : d });
    }

    // Set up "ring both cells": create a TeXML app pointing at office-texml and
    // re-point the office DID to it, so dialing the DID rings Teddy + Danielle.
    if (action === 'ringgroup') {
      const voiceUrl = `${SITE}/.netlify/functions/office-texml`;
      // 1) find or create the TeXML application
      let appId = null;
      const la = await fetch(`${TELNYX}/texml_applications?page[size]=100`, { headers: H, signal: AbortSignal.timeout(12000) });
      const ld = await la.json().catch(() => ({}));
      const existing = (ld.data || []).find((a) => (a.friendly_name === 'Ant Office Ring Group') || (a.voice_url === voiceUrl));
      if (existing) appId = existing.id;
      if (!appId) {
        const ca = await fetch(`${TELNYX}/texml_applications`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ friendly_name: 'Ant Office Ring Group', voice_url: voiceUrl, voice_method: 'POST', active: true }),
          signal: AbortSignal.timeout(12000),
        });
        const cd = await ca.json().catch(() => ({}));
        if (!ca.ok) return json(200, { ok: false, step: 'create_texml_app', status: ca.status, error: JSON.stringify(cd.errors || cd).slice(0, 300) });
        appId = cd.data && cd.data.id;
      }
      if (!appId) return json(200, { ok: false, error: 'no TeXML app id' });

      // 1b) attach an outbound voice profile so the TeXML <Dial> can call the cells
      // (same gap that broke the Vapi app — without it the dial leg fails -> silent).
      let outboundProfileId = q.profile;
      if (!outboundProfileId) {
        try { const op = await fetch(`${TELNYX}/outbound_voice_profiles?page[size]=10`, { headers: H, signal: AbortSignal.timeout(10000) }); outboundProfileId = (((await op.json().catch(() => ({}))).data || [])[0] || {}).id; } catch (_) {}
      }
      if (outboundProfileId) {
        await fetch(`${TELNYX}/texml_applications/${appId}`, {
          method: 'PATCH', headers: H, body: JSON.stringify({ outbound: { outbound_voice_profile_id: outboundProfileId } }), signal: AbortSignal.timeout(12000),
        }).catch(() => {});
      }

      // 2) find the office DID's phone-number id
      const pn = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${encodeURIComponent(OFFICE_DID)}`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pn.json().catch(() => ({}));
      const numId = pd.data && pd.data[0] && pd.data[0].id;
      if (!numId) return json(200, { ok: false, step: 'find_did', error: `${OFFICE_DID} not found on account` });

      // 3) re-point the DID at the TeXML app
      const up = await fetch(`${TELNYX}/phone_numbers/${numId}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ connection_id: appId }), signal: AbortSignal.timeout(12000),
      });
      const ud = await up.json().catch(() => ({}));
      if (!up.ok) return json(200, { ok: false, step: 'repoint_did', status: up.status, error: JSON.stringify(ud.errors || ud).slice(0, 300) });

      return json(200, { ok: true, texml_app_id: appId, voice_url: voiceUrl, did: OFFICE_DID, did_now_points_to: 'Ant Office Ring Group', note: 'Dialing the office DID now rings both cells.' });
    }

    // Inspect a number's Telnyx wiring + the connection's outbound profile, to
    // see why Vapi transfers fail. &num=+16152802949
    if (action === 'numinfo') {
      const want = encodeURIComponent(q.num || '+16152802949');
      const pn = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${want}`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pn.json().catch(() => ({}));
      const rec = pd.data && pd.data[0];
      if (!rec) return json(200, { ok: false, error: 'number not found on Telnyx' });
      const connId = rec.connection_id;
      // voice settings for the number (has the outbound profile + tech prefix etc.)
      let voice = null;
      try { const vr = await fetch(`${TELNYX}/phone_numbers/${rec.id}/voice`, { headers: H, signal: AbortSignal.timeout(10000) }); voice = (await vr.json().catch(() => ({}))).data; } catch (_) {}
      // try to resolve the connection across the common types
      let conn = null;
      for (const path of ['credential_connections', 'texml_applications', 'call_control_applications', 'ip_connections', 'fqdn_connections']) {
        try {
          const cr = await fetch(`${TELNYX}/${path}/${connId}`, { headers: H, signal: AbortSignal.timeout(8000) });
          if (cr.ok) { const cd = await cr.json(); conn = { type: path, data: cd.data }; break; }
        } catch (_) {}
      }
      // also list outbound voice profiles we could attach
      let profiles = [];
      try { const op = await fetch(`${TELNYX}/outbound_voice_profiles?page[size]=50`, { headers: H, signal: AbortSignal.timeout(10000) }); profiles = ((await op.json().catch(() => ({}))).data || []).map((p) => ({ id: p.id, name: p.name })); } catch (_) {}
      return json(200, {
        ok: true, number: rec.phone_number, connection_id: connId,
        connection_type: conn && conn.type,
        connection_name: conn && conn.data && (conn.data.connection_name || conn.data.friendly_name),
        outbound_voice_profile_id: (conn && conn.data && conn.data.outbound && conn.data.outbound.outbound_voice_profile_id) || (conn && conn.data && conn.data.outbound_voice_profile_id) || null,
        connection_outbound: conn && conn.data && conn.data.outbound,
        outbound_profiles_available: profiles,
      });
    }

    // Attach an outbound voice profile to the call-control app behind a number, so
    // Vapi's transfer can dial the outbound leg. &num=...&profile=<id>
    if (action === 'fixoutbound') {
      const want = encodeURIComponent(q.num || '+16152802949');
      const pn = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${want}`, { headers: H, signal: AbortSignal.timeout(12000) });
      const rec = ((await pn.json().catch(() => ({}))).data || [])[0];
      if (!rec) return json(200, { ok: false, error: 'number not found' });
      const connId = rec.connection_id;
      const profile = q.profile;
      if (!profile) return json(400, { ok: false, error: 'pass &profile=<outbound_voice_profile_id>' });
      const r = await fetch(`${TELNYX}/call_control_applications/${connId}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ outbound: { outbound_voice_profile_id: profile } }), signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, status: r.status, error: JSON.stringify(d.errors || d).slice(0, 300) });
      return json(200, { ok: true, connection_id: connId, outbound_now: d.data && d.data.outbound });
    }

    // Inspect an outbound voice profile (allowed destinations, etc.) + optionally
    // open it up to US calling. &action=profileinfo  (&fix=1 to whitelist US/CA)
    if (action === 'profileinfo') {
      const pid = q.id || '2959911839888049315';
      const r = await fetch(`${TELNYX}/outbound_voice_profiles/${pid}`, { headers: H, signal: AbortSignal.timeout(10000) });
      const d = await r.json().catch(() => ({}));
      const p = d.data || {};
      if (q.fix === '1') {
        const up = await fetch(`${TELNYX}/outbound_voice_profiles/${pid}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ enabled: true, traffic_type: 'conversational', service_plan: 'global', whitelisted_destinations: ['US', 'CA'] }),
          signal: AbortSignal.timeout(12000),
        });
        const ud = await up.json().catch(() => ({}));
        return json(200, { ok: up.ok, fixed: true, whitelisted_destinations: ud.data && ud.data.whitelisted_destinations, enabled: ud.data && ud.data.enabled });
      }
      return json(200, {
        ok: r.ok, id: pid, name: p.name, enabled: p.enabled,
        whitelisted_destinations: p.whitelisted_destinations, traffic_type: p.traffic_type,
        service_plan: p.service_plan, usage_payment_method: p.usage_payment_method,
        max_destination_rate: p.max_destination_rate,
      });
    }

    // Force-attach the outbound profile to the ring-group TeXML app (full PATCH
    // with required fields, since a partial patch was being dropped).
    if (action === 'fixtexml') {
      const id = q.id || '2988900469658617248';
      const profile = q.profile || '2959911839888049315';
      const body = {
        friendly_name: 'Ant Office Ring Group',
        voice_url: `${SITE}/.netlify/functions/office-texml`,
        voice_method: 'post',
        active: true,
        outbound: { outbound_voice_profile_id: profile },
      };
      const r = await fetch(`${TELNYX}/texml_applications/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, status: r.status, error: JSON.stringify(d.errors || d).slice(0, 400) });
      return json(200, { ok: true, outbound_now: d.data && d.data.outbound });
    }

    // Dump the ring-group TeXML app config (voice_url + outbound profile).
    if (action === 'texmlinfo') {
      const id = q.id || '2988900469658617248';
      const r = await fetch(`${TELNYX}/texml_applications/${id}`, { headers: H, signal: AbortSignal.timeout(10000) });
      const d = await r.json().catch(() => ({}));
      const a = d.data || {};
      return json(200, { ok: r.ok, status: r.status, friendly_name: a.friendly_name, active: a.active, voice_url: a.voice_url, voice_method: a.voice_method, voice_fallback_url: a.voice_fallback_url, outbound: a.outbound, anchorsite_override: a.anchorsite_override });
    }

    // Recent Telnyx voice call records (from/to/hangup cause) to see why the
    // transfer leg fails. &action=cdr
    if (action === 'cdr') {
      const r = await fetch(`${TELNYX}/detail_records?filter[record_type]=voice&page[size]=15`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, status: r.status, error: JSON.stringify(d.errors || d).slice(0, 400) });
      const recs = (d.data || []).map((x) => ({
        from: x.from || x.from_, to: x.to,
        cause: x.hangup_cause || x.cause || x.failed_message,
        source: x.hangup_source, dir: x.direction || x.call_type,
        status: x.status, dur: x.call_sec || x.duration_seconds || x.billed_sec,
        started: x.started_at || x.created_at,
      }));
      return json(200, { ok: r.ok, status: r.status, records: recs, sample_keys: d.data && d.data[0] ? Object.keys(d.data[0]) : [] });
    }

    if (action === 'connections') {
      // Find the office-phone credential connection's real id + name.
      const r = await fetch(`${TELNYX}/credential_connections?page[size]=100`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      const conns = (d.data || []).map((c) => ({ id: c.id, name: c.connection_name || c.name }));
      return json(200, { ok: r.ok, connections: conns });
    }

    if (action === 'messaging') {
      // Read-only: which numbers can TEXT, and where each one's INBOUND routes.
      // Lists every phone number → its messaging profile → that profile's inbound
      // webhook URL. A number with no profile can't text; a profile with no
      // webhook (or the wrong one) = inbound texts go nowhere.
      const pr = await fetch(`${TELNYX}/messaging_profiles?page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pr.json().catch(() => ({}));
      const profiles = {};
      (pd.data || []).forEach((p) => { profiles[p.id] = { name: p.name, enabled: p.enabled, webhook_url: p.webhook_url || '', webhook_api_version: p.webhook_api_version || '' }; });

      const nr = await fetch(`${TELNYX}/phone_numbers?page[size]=100`, { headers: H, signal: AbortSignal.timeout(15000) });
      const nd = await nr.json().catch(() => ({}));
      const nums = nd.data || [];
      const out = [];
      for (let i = 0; i < nums.length && i < 25; i++) {
        const n = nums[i] || {};
        let profId = n.messaging_profile_id || null;
        if (!profId && n.id) {
          try {
            const mr = await fetch(`${TELNYX}/phone_numbers/${n.id}/messaging`, { headers: H, signal: AbortSignal.timeout(8000) });
            const md = await mr.json().catch(() => ({}));
            profId = (md.data && md.data.messaging_profile_id) || null;
          } catch (_) {}
        }
        const prof = profId ? (profiles[profId] || { name: '(unknown profile)', webhook_url: '' }) : null;
        out.push({
          phone_number: n.phone_number,
          can_text: !!prof,
          messaging_profile: prof ? prof.name : '(none — cannot send/receive texts)',
          inbound_webhook: prof ? (prof.webhook_url || '(profile has NO inbound webhook → texts go nowhere)') : '',
        });
      }
      return json(200, { ok: true, profiles, numbers: out });
    }

    if (action === 'setsms') {
      // WRITE: route customer numbers -> customer-sms-inbound and tech numbers ->
      // tech-sms-inbound. Creates a dedicated customer messaging profile if one
      // doesn't exist yet. Idempotent (reuses profiles by webhook).
      //   ?action=setsms&customer=+1...[,+1...]&tech=+1...[,+1...]
      const custWebhook = `${SITE}/.netlify/functions/customer-sms-inbound`;
      const techWebhook = `${SITE}/.netlify/functions/tech-sms-inbound`;
      const customerNums = String(q.customer || '').split(',').map((s) => s.trim()).filter(Boolean);
      const techNums = String(q.tech || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!customerNums.length && !techNums.length) return json(400, { ok: false, error: 'pass &customer=+1...[,+1...] and/or &tech=+1...' });

      const pr = await fetch(`${TELNYX}/messaging_profiles?page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pr.json().catch(() => ({}));
      const profs = pd.data || [];
      const findByWebhook = (frag) => profs.find((p) => String(p.webhook_url || '').includes(frag));

      let custProf = findByWebhook('customer-sms-inbound');
      if (!custProf && customerNums.length) {
        const cr = await fetch(`${TELNYX}/messaging_profiles`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ name: 'TN Appliance Customer SMS', webhook_url: custWebhook, webhook_api_version: '2', whitelisted_destinations: ['US', 'CA'] }),
          signal: AbortSignal.timeout(12000),
        });
        const cd = await cr.json().catch(() => ({}));
        if (!cr.ok) return json(200, { ok: false, step: 'create_customer_profile', error: JSON.stringify(cd.errors || cd).slice(0, 300) });
        custProf = cd.data;
      }
      let techProf = findByWebhook('tech-sms-inbound');
      if (!techProf && techNums.length) {
        const tr = await fetch(`${TELNYX}/messaging_profiles`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ name: 'TN Appliance Tech SMS', webhook_url: techWebhook, webhook_api_version: '2', whitelisted_destinations: ['US', 'CA'] }),
          signal: AbortSignal.timeout(12000),
        });
        const td = await tr.json().catch(() => ({}));
        if (!tr.ok) return json(200, { ok: false, step: 'create_tech_profile', error: JSON.stringify(td.errors || td).slice(0, 300) });
        techProf = td.data;
      }

      const assign = async (e164, profId) => {
        const fr = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${encodeURIComponent(e164)}`, { headers: H, signal: AbortSignal.timeout(12000) });
        const fd = await fr.json().catch(() => ({}));
        const rec = (fd.data || [])[0];
        if (!rec) return { number: e164, ok: false, error: 'number not found' };
        const ur = await fetch(`${TELNYX}/phone_numbers/${rec.id}/messaging`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ messaging_profile_id: profId }),
          signal: AbortSignal.timeout(12000),
        });
        const ud = await ur.json().catch(() => ({}));
        return { number: e164, ok: ur.ok, error: ur.ok ? null : JSON.stringify(ud.errors || ud).slice(0, 200) };
      };

      const results = [];
      for (const e of customerNums) results.push({ role: 'customer', ...(await assign(e, custProf && custProf.id)) });
      for (const e of techNums) results.push({ role: 'tech', ...(await assign(e, techProf && techProf.id)) });

      return json(200, {
        ok: true,
        customer_profile: custProf ? { id: custProf.id, name: custProf.name, webhook: custProf.webhook_url } : null,
        tech_profile: techProf ? { id: techProf.id, name: techProf.name, webhook: techProf.webhook_url } : null,
        results,
      });
    }

    if (action === 'sethuman') {
      // Route the SHARED HUMAN line to its own profile → human-line-inbound (no AI).
      // Creates the "TN Appliance Human SMS" profile if missing. Idempotent.
      //   ?action=sethuman&number=+16157575500
      const humanWebhook = `${SITE}/.netlify/functions/human-line-inbound`;
      const humanNums = String(q.number || '+16157575500').split(',').map((s) => s.trim()).filter(Boolean);
      const pr = await fetch(`${TELNYX}/messaging_profiles?page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pr.json().catch(() => ({}));
      let humanProf = (pd.data || []).find((p) => String(p.webhook_url || '').includes('human-line-inbound'));
      if (!humanProf) {
        const cr = await fetch(`${TELNYX}/messaging_profiles`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ name: 'TN Appliance Human SMS', webhook_url: humanWebhook, webhook_api_version: '2', whitelisted_destinations: ['US', 'CA'] }),
          signal: AbortSignal.timeout(12000),
        });
        const cd = await cr.json().catch(() => ({}));
        if (!cr.ok) return json(200, { ok: false, step: 'create_human_profile', error: JSON.stringify(cd.errors || cd).slice(0, 300) });
        humanProf = cd.data;
      }
      const results = [];
      for (const e of humanNums) {
        const fr = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${encodeURIComponent(e)}`, { headers: H, signal: AbortSignal.timeout(12000) });
        const fd = await fr.json().catch(() => ({}));
        const rec = (fd.data || [])[0];
        if (!rec) { results.push({ number: e, ok: false, error: 'number not found' }); continue; }
        const ur = await fetch(`${TELNYX}/phone_numbers/${rec.id}/messaging`, {
          method: 'PATCH', headers: H, body: JSON.stringify({ messaging_profile_id: humanProf.id }), signal: AbortSignal.timeout(12000),
        });
        const ud = await ur.json().catch(() => ({}));
        results.push({ number: e, ok: ur.ok, error: ur.ok ? null : JSON.stringify(ud.errors || ud).slice(0, 200) });
      }
      return json(200, { ok: true, human_profile: { id: humanProf.id, name: humanProf.name, webhook: humanProf.webhook_url }, results });
    }

    if (action === 'settech') {
      // Route a number to the TECH profile → tech-sms-inbound (the tech brain). Used
      // after moving tech-direction outbound to 757-5500 so tech replies land right.
      //   ?action=settech&number=+16157575500
      const techWebhook = `${SITE}/.netlify/functions/tech-sms-inbound`;
      const techNums = String(q.number || '+16157575500').split(',').map((s) => s.trim()).filter(Boolean);
      const pr = await fetch(`${TELNYX}/messaging_profiles?page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const pd = await pr.json().catch(() => ({}));
      let techProf = (pd.data || []).find((p) => String(p.webhook_url || '').includes('tech-sms-inbound'));
      if (!techProf) {
        const cr = await fetch(`${TELNYX}/messaging_profiles`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ name: 'TN Appliance Exchange SMS', webhook_url: techWebhook, webhook_api_version: '2', whitelisted_destinations: ['US', 'CA'] }),
          signal: AbortSignal.timeout(12000),
        });
        const cd = await cr.json().catch(() => ({}));
        if (!cr.ok) return json(200, { ok: false, step: 'create_tech_profile', error: JSON.stringify(cd.errors || cd).slice(0, 300) });
        techProf = cd.data;
      }
      const results = [];
      for (const e of techNums) {
        const fr = await fetch(`${TELNYX}/phone_numbers?filter[phone_number]=${encodeURIComponent(e)}`, { headers: H, signal: AbortSignal.timeout(12000) });
        const fd = await fr.json().catch(() => ({}));
        const rec = (fd.data || [])[0];
        if (!rec) { results.push({ number: e, ok: false, error: 'number not found' }); continue; }
        const ur = await fetch(`${TELNYX}/phone_numbers/${rec.id}/messaging`, {
          method: 'PATCH', headers: H, body: JSON.stringify({ messaging_profile_id: techProf.id }), signal: AbortSignal.timeout(12000),
        });
        const ud = await ur.json().catch(() => ({}));
        results.push({ number: e, ok: ur.ok, error: ur.ok ? null : JSON.stringify(ud.errors || ud).slice(0, 200) });
      }
      return json(200, { ok: true, tech_profile: { id: techProf.id, name: techProf.name, webhook: techProf.webhook_url }, results });
    }

    if (action === 'warrantytest') {
      // Send Jimmy + Danielle the EXACT warranty-customer link, FROM the customer
      // line (588-9500), so they see what a warranty customer gets + can reply
      // (→ customer-sms-inbound → Ant). Teddy's preview, 2026-06-26.
      const from = '+16155889500';
      const link = 'https://tnapplianceexchange.net';
      const recips = [
        { name: 'Jimmy', to: '+16159671304' },
        { name: 'Danielle', to: '+16154850713' },
      ];
      const out = [];
      for (const rc of recips) {
        const text = `Hi ${rc.name}, this is Ant with TN Appliance Exchange about your dryer repair. The fastest way to get your tech out ready to fix it the first time — tap here to send a quick video + a photo of the model sticker, takes about 60 seconds: ${link}  Or just reply right here and I'll help you. (Reply STOP to opt out.)`;
        try {
          const send = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: rc.to, text }), signal: AbortSignal.timeout(12000) });
          const sd = await send.json().catch(() => ({}));
          out.push({ name: rc.name, to: rc.to, ok: send.ok, id: (sd.data && sd.data.id) || null, error: send.ok ? null : JSON.stringify(sd.errors || sd).slice(0, 200) });
        } catch (e) { out.push({ name: rc.name, to: rc.to, ok: false, error: String((e && e.message) || e) }); }
      }
      return json(200, { ok: true, from, link, sent: out });
    }

    if (action === 'crewpreview') {
      // ONE-TIME: show the crew the POPULATED Teddy Tool — Jimmy's real warranty
      // Quick Check (video + model photo + auto-read model#) — so they see what the
      // office/Teddy see the second a warranty customer runs it. From the customer
      // line so it threads back to Ant if anyone replies. Teddy, 2026-06-26.
      const from = '+16155889500';
      const job = String(q.job || '19928').replace(/\D/g, '') || '19928';
      const link = `${SITE}/teddy-tdr-tool.html?job_id=${job}`;
      const recips = [
        { name: 'Teddy', to: '+16154855795' },
        { name: 'Jimmy', to: '+16159671304' },
        { name: 'Andre', to: '+15049099413' },
        { name: 'Lee', to: '+16158291654' },
        { name: 'John', to: '+18133527686' },
        { name: 'Danielle', to: '+16154850713' },
      ];
      const out = [];
      for (const rc of recips) {
        const text = `${rc.name}, this is what Teddy + the office see the moment a warranty customer runs the Quick Check — this is Jimmy's real test: his video, the model-sticker photo, and the model # auto-read off it (GE GSE25GSHCSS). Open it: ${link}  This is the one link we send every warranty customer — let's talk through it next week. (Reply STOP to opt out.)`;
        try {
          const send = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: rc.to, text }), signal: AbortSignal.timeout(12000) });
          const sd = await send.json().catch(() => ({}));
          out.push({ name: rc.name, to: rc.to, ok: send.ok, id: (sd.data && sd.data.id) || null, error: send.ok ? null : JSON.stringify(sd.errors || sd).slice(0, 200) });
        } catch (e) { out.push({ name: rc.name, to: rc.to, ok: false, error: String((e && e.message) || e) }); }
      }
      return json(200, { ok: true, from, job, link, sent: out });
    }

    if (action === 'techtool') {
      // Text ONE tech the populated Teddy Tool link for a specific job, with an
      // optional note. From the tech line (857-8800) so replies hit the tech brain.
      //   ?action=techtool&job=19979&to=+16159671304&note=<url-encoded>
      const from = '+16158578800';
      const job = String(q.job || '').replace(/\D/g, '');
      if (!job) return json(400, { ok: false, error: 'pass &job=' });
      const toRaw = String(q.to || '').replace(/[^\d+]/g, '');
      if (toRaw.replace(/\D/g, '').length < 10) return json(400, { ok: false, error: 'pass &to=<tech phone>' });
      const dest = toRaw.startsWith('+') ? toRaw : ('+1' + toRaw.replace(/^1/, ''));
      const link = `${SITE}/teddy-tdr-tool.html?job_id=${job}`;
      let note = ''; try { note = q.note ? decodeURIComponent(q.note) : ''; } catch (_) { note = q.note || ''; }
      const text = (note ? note + '\n\n' : '') + `Teddy Tool for this job — diagnosis, photos/video, parts, all in one place: ${link}`;
      try {
        const send = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: dest, text }), signal: AbortSignal.timeout(12000) });
        const sd = await send.json().catch(() => ({}));
        return json(200, { ok: send.ok, from, to: dest, job, link, id: (sd.data && sd.data.id) || null, error: send.ok ? null : JSON.stringify(sd.errors || sd).slice(0, 300) });
      } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
    }

    if (action === 'testlink') {
      // Send the $1 cash Quick Check test link to Teddy (or &to=) FROM the customer
      // line 588-9500 — so we also prove SMS-with-a-link actually DELIVERS to a real
      // phone (a cash customer reported never getting our links; HCP's got through →
      // smells like carrier A2P/10DLC URL filtering). Teddy, 2026-06-26.
      const from = '+16155889500';
      const to = String(q.to || '+16154855795').replace(/[^\d+]/g, '');
      const dest = to.startsWith('+') ? to : ('+1' + to.replace(/^1/, ''));
      const link = `${SITE}/?qc=tn-qc-test-2026`;
      const text = `TN Appliance — here's the $1 test of the Quick Check. Tap to run it end-to-end (Dryer → I'm paying myself → record a 10-15s video → snap any model sticker → pay $1): ${link}  (Reply STOP to opt out.)`;
      try {
        const send = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: dest, text }), signal: AbortSignal.timeout(12000) });
        const sd = await send.json().catch(() => ({}));
        return json(200, { ok: send.ok, from, to: dest, link, id: (sd.data && sd.data.id) || null, error: send.ok ? null : JSON.stringify(sd.errors || sd).slice(0, 300) });
      } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
    }

    if (action === 'customerlink') {
      // Send a customer a labeled intake link from the customer line (588-9500),
      // pre-set to one appliance. &free=1 waives the charge (multi-machine / trip-fee
      // customers). One call per machine. Reply lands on customer-sms-inbound → Ant.
      const from = '+16155889500';
      const to = String(q.to || '').replace(/[^\d+]/g, '');
      if (to.replace(/\D/g, '').length < 10) return json(400, { ok: false, error: 'pass &to=<customer phone>' });
      const dest = to.startsWith('+') ? to : ('+1' + to.replace(/^1/, ''));
      const appliance = String(q.appliance || '').trim() || 'appliance';
      const name = String(q.name || '').trim();
      const isFree = String(q.free || '') === '1';
      const job = String(q.job || '').replace(/\D/g, '');
      const payNote = String(q.paynote || '') === '1';
      const hi = name ? `Hi ${name}, ` : 'Hi, ';
      let link, text;
      if (job) {
        // No-form "just shoot it" link tied to an existing job (finish-upload =
        // video + model photo only, no fields to fill). Used for multi-machine /
        // already-known customers. paynote=1 => flat $50, pay at the visit.
        link = `${SITE}/finish-upload.html?job_id=${job}`;
        const pay = payNote ? ' It\'s a flat $50 Quick Check — you can take care of it whenever our tech comes out.' : '';
        text = `${hi}this is Ant with TN Appliance Exchange. For your ${appliance.toUpperCase()} 👇 please shoot a quick video of what it's doing + a CLEAR photo of the model-number sticker right here (no forms, ~60 sec):${pay} ${link}  (Reply STOP to opt out.)`;
      } else {
        // &dollar=1 → $1 Quick Check (qc test token). &free=1 → $0. else $50.
        const isDollar = String(q.dollar || '') === '1';
        const pre = isFree ? 'free=tn-free-2026&' : (isDollar ? 'qc=tn-qc-test-2026&' : '');
        link = `${SITE}/appliance-ai.html?${pre}appliance=${encodeURIComponent(appliance)}`;
        const priceClause = isFree ? 'No charge for this one — it\'s covered by your trip fee. '
          : (isDollar ? 'It\'s just $1 to get it in our system. ' : '');
        text = `${hi}this is Ant with TN Appliance Exchange. Here's your link for your ${appliance.toUpperCase()} 👇 Tap it, record a short video of what it's doing, snap a clear photo of the model-number sticker, and I'll take a look and tell you straight whether it's worth fixing. ${priceClause}${link}  (Reply STOP to opt out.)`;
      }
      try {
        const send = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: dest, text }), signal: AbortSignal.timeout(12000) });
        const sd = await send.json().catch(() => ({}));
        return json(200, { ok: send.ok, from, to: dest, appliance, free: isFree, dollar: String(q.dollar || '') === '1', link, id: (sd.data && sd.data.id) || null, error: send.ok ? null : JSON.stringify(sd.errors || sd).slice(0, 300) });
      } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
    }

    if (action === 'customermsg') {
      // Send an arbitrary custom message to a customer FROM the customer line
      // (588-9500) so any reply threads back to Ant. ?action=customermsg&to=+1...&msg=<url-encoded>
      const from = '+16155889500';
      const to = String(q.to || '').replace(/[^\d+]/g, '');
      if (to.replace(/\D/g, '').length < 10) return json(400, { ok: false, error: 'pass &to=<customer phone>' });
      const dest = to.startsWith('+') ? to : ('+1' + to.replace(/^1/, ''));
      let msg = ''; try { msg = q.msg ? decodeURIComponent(q.msg) : ''; } catch (_) { msg = q.msg || ''; }
      msg = String(msg || '').trim();
      if (!msg) return json(400, { ok: false, error: 'pass &msg=<url-encoded text>' });
      try {
        const send = await fetch(`${TELNYX}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: dest, text: msg }), signal: AbortSignal.timeout(12000) });
        const sd = await send.json().catch(() => ({}));
        return json(200, { ok: send.ok, from, to: dest, id: (sd.data && sd.data.id) || null, error: send.ok ? null : JSON.stringify(sd.errors || sd).slice(0, 300) });
      } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
    }

    if (action === 'list') {
      const r = await fetch(`${TELNYX}/telephony_credentials?filter[connection_id]=${connId}&page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      const creds = (d.data || []).map((c) => ({ id: c.id, name: c.name, sip_username: c.sip_username, expired: c.expired }));
      return json(200, { ok: r.ok, connection_id: connId, credentials: creds });
    }

    if (action === 'create') {
      // Each office-phone person gets their OWN SIP login (sharing one credential
      // caused the WebSocket thrash that dropped calls). Teddy = default (no suffix),
      // everyone else gets a name-suffixed vault key that telnyx-webrtc-token reads.
      const PEOPLE = {
        teddy:    { label: 'Teddy',    suffix: '' },
        danielle: { label: 'Danielle', suffix: '_DANIELLE' },
        sofia:    { label: 'Sofia',    suffix: '_SOFIA' },
      };
      const who = String(q.who || '').toLowerCase();
      const person = PEOPLE[who];
      if (!person) return json(400, { ok: false, error: 'pass &who= one of: ' + Object.keys(PEOPLE).join(', ') });
      const name = 'Ant Office Phone - ' + person.label;
      const r = await fetch(`${TELNYX}/telephony_credentials`, {
        method: 'POST', headers: H, body: JSON.stringify({ connection_id: connId, name }), signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, status: r.status, error: (d.errors && JSON.stringify(d.errors)) || JSON.stringify(d).slice(0, 300) });
      const c = d.data || {};
      if (!c.sip_username || !c.sip_password) return json(200, { ok: false, error: 'no sip_username/password returned', raw: c });
      const suffix = person.suffix;
      await setSecret('TELNYX_SIP_USERNAME' + suffix, c.sip_username);
      await setSecret('TELNYX_SIP_PASSWORD' + suffix, c.sip_password);
      return json(200, {
        ok: true, who, credential_id: c.id, sip_username: c.sip_username,
        vaulted: ['TELNYX_SIP_USERNAME' + suffix, 'TELNYX_SIP_PASSWORD' + suffix],
        note: person.label + "'s login is created and saved. Their app will use it on next On.",
      });
    }

    return json(400, { ok: false, error: 'unknown action; use create|list' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
