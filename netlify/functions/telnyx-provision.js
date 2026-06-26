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

    if (action === 'list') {
      const r = await fetch(`${TELNYX}/telephony_credentials?filter[connection_id]=${connId}&page[size]=50`, { headers: H, signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      const creds = (d.data || []).map((c) => ({ id: c.id, name: c.name, sip_username: c.sip_username, expired: c.expired }));
      return json(200, { ok: r.ok, connection_id: connId, credentials: creds });
    }

    if (action === 'create') {
      const who = String(q.who || '').toLowerCase();
      if (who !== 'teddy' && who !== 'danielle') return json(400, { ok: false, error: 'pass &who=teddy or &who=danielle' });
      const name = 'Ant Office Phone - ' + (who === 'danielle' ? 'Danielle' : 'Teddy');
      const r = await fetch(`${TELNYX}/telephony_credentials`, {
        method: 'POST', headers: H, body: JSON.stringify({ connection_id: connId, name }), signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return json(200, { ok: false, status: r.status, error: (d.errors && JSON.stringify(d.errors)) || JSON.stringify(d).slice(0, 300) });
      const c = d.data || {};
      if (!c.sip_username || !c.sip_password) return json(200, { ok: false, error: 'no sip_username/password returned', raw: c });
      const suffix = who === 'danielle' ? '_DANIELLE' : '';
      await setSecret('TELNYX_SIP_USERNAME' + suffix, c.sip_username);
      await setSecret('TELNYX_SIP_PASSWORD' + suffix, c.sip_password);
      return json(200, {
        ok: true, who, credential_id: c.id, sip_username: c.sip_username,
        vaulted: ['TELNYX_SIP_USERNAME' + suffix, 'TELNYX_SIP_PASSWORD' + suffix],
        note: who + "'s login is created and saved. Their app will use it on next On.",
      });
    }

    return json(400, { ok: false, error: 'unknown action; use create|list' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
