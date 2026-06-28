// meistertask-analyze — control surface for the archive analysis.
//   ?secret=            -> fire the background analysis (add &board=TN%20Jobs to scope)
//   ?status=1&secret=   -> read the latest stored _analysis result
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };

  if (q.status) {
    try {
      const rows = await sb.select(TABLE, { board: 'eq._analysis', order: 'imported_at.desc', limit: '1' });
      const latest = (rows && rows[0] && rows[0].card) || null;
      return { statusCode: 200, body: JSON.stringify({ ok: !!latest, analysis: latest }, null, 2) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
    }
  }

  try {
    const url = `${SITE}/.netlify/functions/meistertask-analyze-background?secret=${encodeURIComponent(admin)}${q.board ? '&board=' + encodeURIComponent(q.board) : ''}`;
    await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {});
    return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true }) };
  }
};
