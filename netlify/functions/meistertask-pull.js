// meistertask-pull — control surface for the MeisterTask history pull.
//   ?probe=1&secret=  -> verify the token + list projects (no writes)
//   ?status=1&secret= -> read what's landed in Supabase (latest manifest + counts)
//   ?secret=          -> fire the background full pull (add &comments=1 to include comments)
'use strict';

const { getSecret } = require('./_lib/secrets');
const mt = require('./_lib/meistertask');
const sb = require('./_lib/supabase');
const TABLE = 'meistertask_archive';

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  if (q.status) {
    try {
      if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };
      // total archived rows (exclude the _manifest marker), via a small page sample + count header isn't exposed,
      // so we read the latest manifest summary which carries the per-board totals.
      const manifests = await sb.select(TABLE, { board: 'eq._manifest', order: 'imported_at.desc', limit: '3' }).catch(() => []);
      const sample = await sb.select(TABLE, { select: 'board', limit: '1' }).catch((e) => { throw e; });
      const latest = (manifests && manifests[0] && manifests[0].card) || null;
      return { statusCode: 200, body: JSON.stringify({ ok: true, table_ok: Array.isArray(sample), latest_manifest: latest, manifests_seen: (manifests || []).length }, null, 2) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e), hint: 'if this says relation/table missing, create meistertask_archive in Supabase' }) };
    }
  }

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
