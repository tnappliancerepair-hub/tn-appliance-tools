// nightly-backup-cron — thin scheduled wrapper.
//
// The schedule lives HERE, not on nightly-backup, because a Netlify function that
// carries its own `schedule` block returns an edge-level 403 on every external
// HTTP call. nightly-backup has real manual controls (?status, ?probe, ?prune)
// that were unreachable for exactly that reason. Core stays curlable; this fires
// the nightly run. Same split as knowledge-scorecard / platform-* crons.
'use strict';

const { getSecret } = require('./_lib/secrets');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');

exports.handler = async function () {
  let admin = '';
  try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  try {
    const url = `${SITE}/.netlify/functions/nightly-backup-background?secret=${encodeURIComponent(admin)}`;
    await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => {});
  } catch (_) {}
  return { statusCode: 200, body: JSON.stringify({ ok: true, triggered: true }) };
};
