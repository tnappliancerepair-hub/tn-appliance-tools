// One-shot label reset: removes AHS-Processed + AHS-Processing +
// ServicePower-Processed + ServicePower-Processing from all matching
// messages newer_than:7d so the pollers re-ingest them.
//
// Trigger: POST /.netlify/functions/reset-gmail-labels
// Returns: { ok, ahs_unlabeled, sp_unlabeled, errors[] }
//
// Idempotent — safe to re-run.

const { google } = require('googleapis');

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

function makeAuth() {
  const o2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  o2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return o2;
}

async function resolveLabelId(gmail, labelName) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const found = (list.data.labels || []).find((l) => l.name === labelName);
  return found ? found.id : null;
}

async function unlabelAllMatching(gmail, query, labelIds) {
  const errors = [];
  let unlabeled = 0;
  let pageToken = null;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
    });
    const msgs = res.data.messages || [];
    if (msgs.length === 0) break;
    pageToken = res.data.nextPageToken || null;
    for (const m of msgs) {
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: m.id,
          requestBody: { removeLabelIds: labelIds },
        });
        unlabeled++;
      } catch (e) {
        errors.push({ id: m.id, error: String(e.message || e) });
      }
    }
  } while (pageToken);
  return { unlabeled, errors };
}

exports.handler = async function () {
  try {
    const auth = makeAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    const ahsProcessedId = await resolveLabelId(gmail, 'AHS-Processed');
    const ahsProcessingId = await resolveLabelId(gmail, 'AHS-Processing');
    const spProcessedId = await resolveLabelId(gmail, 'ServicePower-Processed');
    const spProcessingId = await resolveLabelId(gmail, 'ServicePower-Processing');

    const ahsLabelIds = [ahsProcessedId, ahsProcessingId].filter(Boolean);
    const spLabelIds = [spProcessedId, spProcessingId].filter(Boolean);

    const ahsResult = ahsLabelIds.length > 0
      ? await unlabelAllMatching(
          gmail,
          'from:noreply@msg.frontdoor.com newer_than:7d (label:AHS-Processed OR label:AHS-Processing)',
          ahsLabelIds,
        )
      : { unlabeled: 0, errors: [{ error: 'no AHS labels found' }] };

    const spResult = spLabelIds.length > 0
      ? await unlabelAllMatching(
          gmail,
          '(from:noreply@servicepower.com OR from:NOREPLY@servicepower.com) newer_than:7d (label:ServicePower-Processed OR label:ServicePower-Processing)',
          spLabelIds,
        )
      : { unlabeled: 0, errors: [{ error: 'no SP labels found' }] };

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        ahs_unlabeled: ahsResult.unlabeled,
        sp_unlabeled: spResult.unlabeled,
        ahs_errors: ahsResult.errors,
        sp_errors: spResult.errors,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(e.message || e) }),
    };
  }
};
