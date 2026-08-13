// warm-phone — keep the phone's lookup path HOT so a cold start never hangs a live
// call. Ann answers 24/7; a Netlify function that's gone cold takes 10–36s on its
// first hit, which is exactly the "call timed out while locating the claim" drop we
// see in the logs. This pings the two functions every call depends on — job-truth
// (the status brain) and vapi-tool (the tool proxy) — on a tight cron so the
// container stays warm and the first real lookup of a call returns in ~0.5s.
//
// Cheap + side-effect-free: job-truth gets a benign job_id read, vapi-tool gets
// get_business_hours (handled locally, no backend write). Never touches customer data.
'use strict';
const SITE = 'https://tnapplianceexchange.net/.netlify/functions';

async function ping(url, opts) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts || {}));
    await r.text();
    return { url, ms: Date.now() - t0, status: r.status };
  } catch (e) { return { url, ms: Date.now() - t0, error: String((e && e.message) || e) }; }
}

exports.handler = async function () {
  const results = await Promise.all([
    // job-truth: cheap known-job read (warms the get_job_for_dashboard path too).
    ping(`${SITE}/job-truth?job_id=20400&lens=customer`),
    // vapi-tool: get_business_hours is answered locally — warms the proxy, no backend.
    ping(`${SITE}/vapi-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { toolCalls: [{ id: 'warm', function: { name: 'get_business_hours', arguments: '{}' } }] } }),
    }),
    // telnyx-precall-context: the NEW Telnyx Ann's greet-by-name webhook. Keep it hot so
    // Telnyx never times out the dynamic-variables call and speaks a raw "{{greeting}}".
    ping(`${SITE}/telnyx-precall-context?phone=6155551212`),
  ]);
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, warmed: results }) };
};
