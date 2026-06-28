// meistertask-pull — control surface for the MeisterTask history pull.
//   ?probe=1&secret=  -> verify the token + list projects (no writes)
//   ?secret=          -> fire the background full pull (add &comments=1 to include comments)
'use strict';

const { getSecret } = require('./_lib/secrets');
const mt = require('./_lib/meistertask');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  if (q.probe) {
    try {
      const projects = await mt.listProjects();
      return { statusCode: 200, body: JSON.stringify({ ok: true, configured: await mt.isConfigured(), project_count: projects.length, projects: projects.map((p) => ({ id: p.id, name: p.name || p.title })) }) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
    }
  }

  try {
    const url = `${SITE}/.netlify/functions/meistertask-pull-background?secret=${encodeURIComponent(admin)}${q.comments ? '&comments=1' : ''}`;
    await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {});
    return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true }) };
  }
};
