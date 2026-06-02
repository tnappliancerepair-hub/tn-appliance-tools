// Gmail diagnostic — searches Gmail with a custom query and returns
// subject/from/labels/snippet for each match. Used to find dispatch
// emails that the AHS/SP/Allstate pollers are missing.
//
// Usage:
//   /.netlify/functions/gmail-diag?q=<encoded gmail query>
//   /.netlify/functions/gmail-diag?days=2  (default: last 2 days dispatch-ish)
//
// Returns the actual sender + subject patterns we need to teach the
// pollers about.

const { google } = require('googleapis');

const DEFAULT_QUERY =
  '(dispatch OR "service request" OR "work order" OR "new assignment" OR "service call" OR appointment OR offer) newer_than:2d in:anywhere';

exports.handler = async (event) => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'gmail_oauth_env_missing' }),
    };
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const params = event.queryStringParameters || {};
  let q = params.q;
  if (!q) {
    const days = Math.min(Number(params.days || 2), 30);
    q = DEFAULT_QUERY.replace('newer_than:2d', `newer_than:${days}d`);
  }

  let messageList;
  try {
    messageList = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 50,
    });
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'gmail_list_failed', message: e.message }),
    };
  }

  const messages = messageList.data.messages || [];
  const results = [];

  for (const m of messages.slice(0, 40)) {
    try {
      const det = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date', 'To'],
      });
      const headers = (det.data.payload && det.data.payload.headers) || [];
      const h = (name) => {
        const f = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
        return f ? f.value : '';
      };
      results.push({
        id: m.id,
        subject: h('Subject'),
        from: h('From'),
        to: h('To'),
        date: h('Date'),
        labels: det.data.labelIds || [],
        snippet: (det.data.snippet || '').slice(0, 200),
      });
    } catch (e) {
      results.push({ id: m.id, error: e.message });
    }
  }

  // Group by sender to surface patterns
  const bySender = {};
  for (const r of results) {
    if (r.error) continue;
    const s = r.from || 'unknown';
    if (!bySender[s]) bySender[s] = { count: 0, sample_subjects: [] };
    bySender[s].count += 1;
    if (bySender[s].sample_subjects.length < 3) {
      bySender[s].sample_subjects.push(r.subject);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        query: q,
        total_returned: results.length,
        by_sender: bySender,
        results,
      },
      null,
      2,
    ),
  };
};
