// platform-warm — keep the phone-AI hot path warm so the FIRST real call is fast.
//
// The greeting path (platform-precall) races a hard 1.8s deadline; a cold Netlify container
// can take 10-15s on the first hit, which loses that race and drops Ann to a generic greeting
// (or, mid-call, risks dead air on the first lookup). This pings the two latency-critical
// functions on a tight cron so a container is always warm when a caller dials.
//
// Side-effect-free: a benign, non-matching demo phone (555-0199) → found:false → a cheap
// read that exercises the function + company resolve + the platform_call_lookup RPC, touching
// no real data and writing nothing. Runs via netlify.toml schedule (every 5 min).
'use strict';

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const CORS = { 'Content-Type': 'application/json' };

async function ping(url, opts) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts || {}));
    return { url: url.split('/.netlify/functions/')[1], ms: Date.now() - t0, status: r.status };
  } catch (e) {
    return { url: url.split('/.netlify/functions/')[1], ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 60) };
  }
}

exports.handler = async function () {
  const results = await Promise.all([
    // the read brain — warms the fn + company resolve + platform_call_lookup RPC
    ping(`${BASE}/platform-call-brain?do=lookup&slug=demo&phone=6155550199`),
    // the greeting webhook — warms precall + its self-fetch to the brain (the 1.8s-race path)
    ping(`${BASE}/platform-precall?slug=demo&phone=6155550199`),
  ]);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, warmed: results }) };
};
