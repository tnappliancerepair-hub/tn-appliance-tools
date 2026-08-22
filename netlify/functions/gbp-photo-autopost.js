// gbp-photo-autopost — turn real job photos into fresh Google Business Profile
// content, SAFELY (Teddy 2026-08-22: "automatically push job photos... option B:
// all job photos with a filter/approve gate").
//
// THE PRIVACY GATE (why this is safe to run on customers' home photos): every
// candidate is screened by Claude Vision and PASSES only if it's an anonymous,
// on-brand appliance/repair shot — NO people, NO identifiable room/home interior,
// NO readable serial numbers, decent quality. Anything that would need consent is
// rejected, so nothing identifiable ever reaches the public profile.
//
// Source: customer_sms_media_captured events (photos customers text in — usually
// their broken appliance). GBP has no video/gallery API, so this posts PHOTOS as
// Business Profile update posts (the only programmatic path Google still allows);
// job VIDEOS route to YouTube/FB/IG via the social pipeline, not here.
//
// STAGED (codebase pattern): default = screen + queue + text Teddy the approved
// candidates for a one-tap look (nothing public yet). Flip vault
// GBP_PHOTO_AUTOPOST_LIVE=true to auto-post the AI-approved ones (1/run, heads-up
// text with a REMOVE link on every post). Kill switch: GBP_PHOTO_AUTOPOST=off.
//
//   GET ?secret=<admin>          screen new photos + queue/post per mode
//   GET ?secret=<admin>&dry=1    screen only, return verdicts, write nothing public
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const gbp = require('./_lib/gbp');
let getSecret; try { ({ getSecret } = require('./_lib/secrets')); } catch (_) {}
let sendSms; try { ({ sendSms } = require('./_lib/sms')); } catch (_) {}
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const EVENT_LOG = 3;
const OWNER = '+16154855795';
const MODEL = 'claude-sonnet-5';
const SCREEN_CAP = 4;              // photos screened per run (cost/time guard)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b) });

const SCREEN_PROMPT = `You screen appliance-repair job photos for PUBLIC posting on our Google Business Profile. Be STRICT — when uncertain, REJECT.
PASS only if ALL of these are true:
1) It clearly shows an appliance, an appliance part, or a repair in progress.
2) NO people, faces, hands, or body parts anywhere.
3) NO identifiable home interior or personal belongings — a plain close-up of the appliance/part is fine, but a shot that shows a kitchen, room, furniture, décor, mail, or personal items is NOT.
4) NO model/serial nameplate with readable serial numbers or any personal info.
5) Good quality: in focus, well-lit, not a dark blur, not a random/irrelevant photo.
6) Nothing embarrassing, gross, or off-brand.
If it PASSES, write a short, friendly, on-brand caption for a Google post (max ~180 chars): mention the appliance/repair generically, no names, no location, no part numbers.
Return ONLY strict JSON: {"pass": true|false, "reason": "short why", "caption": "caption if pass else empty"}`;

function isPhotoKey(k) { const s = String(k || '').toLowerCase(); return /\.(jpg|jpeg|png|webp|heic|heif)$/.test(s) && s.indexOf('cfstream:') !== 0; }
function imgUrl(key) { return `${SITE}/.netlify/functions/sms-media?key=${encodeURIComponent(key)}`; }

async function rows(action, days, limit) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${action}&days_back=${days}&limit=${limit}`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    const its = (d && (d.items || d)) || [];
    return Array.isArray(its) ? its : [];
  } catch (_) { return []; }
}
function md(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

async function screenOne(key) {
  // fetch bytes (sms-media 302 -> signed S3), base64, Claude Vision verdict
  let b64, mt = 'image/jpeg';
  try {
    const r = await fetch(imgUrl(key), { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { pass: false, reason: 'fetch ' + r.status };
    mt = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!/^image\//.test(mt)) mt = 'image/jpeg';
    b64 = Buffer.from(new Uint8Array(await r.arrayBuffer())).toString('base64');
  } catch (e) { return { pass: false, reason: 'fetch_err' }; }
  try {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
        { type: 'text', text: SCREEN_PROMPT },
      ] }] }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await ar.json();
    let txt = (d && d.content && d.content[0] && d.content[0].text) || '';
    txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
    const m = txt.match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : { pass: false, reason: 'no_json' };
    return { pass: !!v.pass, reason: String(v.reason || '').slice(0, 120), caption: String(v.caption || '').slice(0, 200) };
  } catch (e) { return { pass: false, reason: 'ai_err' }; }
}

exports.handler = async function (event) {
  try {
    const q = event.queryStringParameters || {};
    let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
    const admin = (getSecret && (await getSecret('VAPI_ADMIN_SECRET'))) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

    const killed = getSecret && String((await getSecret('GBP_PHOTO_AUTOPOST')) || '').toLowerCase() === 'off';
    if (killed) return json(200, { ok: true, disabled: true });
    const dry = q.dry === '1';
    const live = !dry && getSecret && String((await getSecret('GBP_PHOTO_AUTOPOST_LIVE')) || '').toLowerCase() === 'true';

    // dedup sets
    const screened = new Set((await rows('gbp_photo_screened', 60, 500)).map((r) => md(r).key).filter(Boolean));
    const posted = new Set((await rows('gbp_photo_posted', 120, 500)).map((r) => md(r).key).filter(Boolean));

    // harvest new photo keys (newest first), cap
    const src = await rows('customer_sms_media_captured', 21, 300);
    const fresh = [];
    for (const row of src) {
      const m = md(row);
      for (const k of (m.keys || [])) {
        if (isPhotoKey(k) && !screened.has(k) && !fresh.find((f) => f.key === k)) fresh.push({ key: k, job_id: m.job_id || 0 });
      }
      if (fresh.length >= SCREEN_CAP) break;
    }

    // screen them IN PARALLEL (Netlify sync cap ~26s; serial vision calls blow past it)
    const cap = q.n ? Math.max(1, Math.min(SCREEN_CAP, parseInt(q.n, 10) || SCREEN_CAP)) : SCREEN_CAP;
    const verdicts = await Promise.all(fresh.slice(0, cap).map(async (f) => {
      const v = await screenOne(f.key);
      if (!dry) { try { await crud.insert(EVENT_LOG, { action: 'gbp_photo_screened', metadata: { key: f.key, job_id: f.job_id, pass: v.pass, reason: v.reason, caption: v.caption || '', at_ms: Date.now() } }); } catch (_) {} }
      return { key: f.key, job_id: f.job_id, ...v };
    }));
    const passed = verdicts.filter((v) => v.pass);

    if (dry) return json(200, { ok: true, mode: 'dry', screened: verdicts.length, passed: passed.length, verdicts });

    // candidate pool = all passing screens not yet posted (this run + prior)
    const priorPass = (await rows('gbp_photo_screened', 60, 500)).map((r) => md(r)).filter((m) => m.pass && m.key && !posted.has(m.key));
    const poolNew = passed.filter((v) => !posted.has(v.key));

    if (!live) {
      // shadow: queue + tell Teddy what the filter approved (throttled)
      const lastNotify = (await rows('gbp_photo_autopost_notify', 1, 1))[0];
      const okNotify = !lastNotify || (Date.now() - (md(lastNotify).at_ms || 0)) > 6 * 3600 * 1000;
      if (poolNew.length && okNotify && sendSms) {
        try {
          await sendSms(OWNER, `[ant] 📸 ${priorPass.length} job photo(s) passed the safety filter for your Google profile. Auto-posting is OFF (shadow) — flip GBP_PHOTO_AUTOPOST_LIVE=true to let it post. Newest OK: "${(poolNew[0].caption || '').slice(0, 80)}"`, 'owner', 'gbp_photo_autopost');
          await crud.insert(EVENT_LOG, { action: 'gbp_photo_autopost_notify', metadata: { at_ms: Date.now(), passed: priorPass.length } });
        } catch (_) {}
      }
      return json(200, { ok: true, mode: 'shadow', screened: verdicts.length, passed_this_run: poolNew.length, queued_total: priorPass.length, note: 'set GBP_PHOTO_AUTOPOST_LIVE=true to auto-post' });
    }

    // LIVE: post the single oldest un-posted candidate this run
    const pick = priorPass.length ? priorPass[priorPass.length - 1] : (poolNew[0] || null);
    if (!pick) return json(200, { ok: true, mode: 'live', posted: 0, note: 'no new safe photos' });
    let postRes = null, postErr = null;
    try { postRes = await gbp.createLocalPost({ summary: pick.caption || 'A repair we handled — real local techs, honest answers. 🛠️', mediaUrl: imgUrl(pick.key) }); }
    catch (e) { postErr = String((e && e.message) || e); }
    const okPost = postRes && (postRes.ok !== false) && (postRes.name || postRes.status === 200 || (postRes.data && postRes.data.name));
    if (okPost) {
      const postName = (postRes.data && postRes.data.name) || postRes.name || '';
      try { await crud.insert(EVENT_LOG, { action: 'gbp_photo_posted', metadata: { key: pick.key, job_id: pick.job_id || 0, caption: pick.caption || '', post_name: postName, at_ms: Date.now() } }); } catch (_) {}
      if (sendSms) { try { await sendSms(OWNER, `[ant] 📸 Posted a job photo to your Google profile: "${(pick.caption || '').slice(0, 90)}". To remove it: gbp-post?secret=&delete=${encodeURIComponent(postName)}`, 'owner', 'gbp_photo_autopost'); } catch (_) {} }
      return json(200, { ok: true, mode: 'live', posted: 1, post_name: postName, caption: pick.caption });
    }
    return json(200, { ok: false, mode: 'live', posted: 0, error: postErr || (postRes && (postRes.error || postRes.status)) || 'post_failed', detail: postRes });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
