// submagic-check — masked diagnostic: is the Submagic API key vaulted + does it
// authenticate? Owner-gated. Does NOT create a billable project.
//   GET ?secret=<VAPI_ADMIN_SECRET>
'use strict';
const { getSecret } = require('./_lib/secrets');
const submagic = require('./_lib/submagic');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  const key = await submagic.apiKey();
  if (!key) return json(200, { ok: false, configured: false, note: 'Add SUBMAGIC_API_KEY in the vault (admin-secrets.html). Business plan = API access.' });

  // Diagnostic: fire a REAL create with our exact options against a clean public sample
  // video, so we see Submagic's raw validation message. ?diag=1 [&video=<url>] [&hook=..] [&template=..]
  if (q.diag === '1' || q.diag === 'true') {
    const video = q.video || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const created = await submagic.createProject({
      videoUrl: video,
      title: q.title || 'TN diag',
      hook: q.hook != null ? q.hook : 'Where do the numbers go on your boat?',
      template: q.template || 'Hormozi 2',
      language: q.language || 'en',
    });
    return json(200, { ok: created.ok, diag: true, sample_video: video, result: created });
  }

  // Cheap authenticated probe — a GET on a nonexistent project id tells us auth works
  // (401/403 = bad key, 404 = key good/no such project). No project is created.
  const r = await submagic.getProject('___auth_probe___');
  const masked = 'sk-…' + String(key).slice(-4);
  const authOk = r.status !== 401 && r.status !== 403;
  return json(200, { ok: authOk, configured: true, key: masked, probe_status: r.status, auth: authOk ? 'valid' : 'REJECTED — check the key' });
};
