// content-post-watch — the near-hands-off trigger for the content engine. Scans the
// studio queue for FINISHED, enriched clips that haven't been posted yet and texts the
// owner ONE approve link per clip: open the studio → tap "Post everywhere" → honest title
// + all platforms in one shot. Dedup per clip so it never nags twice. Scheduled + manual.
// Kill switch: vault CONTENT_POST_WATCH=false.
'use strict';
const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';
const SEEN_KEY = 'CONTENT_POST_NOTIFIED';
const MAX_PER_RUN = 4;
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // scheduled runs carry {next_run} and self-authorize; manual runs need ?secret=
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const off = String((await getSecretFresh('CONTENT_POST_WATCH')) || '').trim().toLowerCase() === 'false';
  if (off) return json(200, { ok: true, disabled: true });

  let queue = []; try { queue = JSON.parse((await getSecretFresh('VIDEO_STUDIO_QUEUE')) || '[]'); } catch (_) {}
  let seen = []; try { seen = JSON.parse((await getSecretFresh(SEEN_KEY)) || '[]'); } catch (_) {}
  const seenSet = new Set(seen);

  // ready + enriched (punched-up) + not yet posted + not already announced
  const fresh = queue.filter((j) => j.status === 'ready' && j.enriched && j.download_url && !seenSet.has(j.id));
  const dry = q.dry === '1';
  const picked = fresh.slice(0, MAX_PER_RUN);

  if (!dry) {
    for (const j of picked) {
      try {
        await sendSms(OWNER, `🎬 New clip ready to post everywhere:\n"${(j.title || 'TN Appliance clip').slice(0, 70)}"\n\nApprove it (honest title auto-written, posts to all 6): ${SITE}/video-studio.html`, 'owner', 'content_ready');
      } catch (_) {}
      seenSet.add(j.id);
    }
    if (picked.length) { try { await setSecret(SEEN_KEY, JSON.stringify(Array.from(seenSet).slice(-300))); } catch (_) {} }
  }

  return json(200, { ok: true, ready_unposted: fresh.length, notified: dry ? 0 : picked.length, dry, titles: picked.map((j) => j.title) });
};
