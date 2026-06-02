// Multi-vendor warranty dispatch poller — bridge for the 25-jobs-a-day
// gap discovered 2026-06-02. The existing AHS + SP pollers only match
// specific from: senders. Real warranty dispatches arrive from many
// addresses (NSA, three SquareTrade variants, Allstate). This poller
// catches the missing senders + ships each raw dispatch to
// record_warranty_email_draft_POST so Danielle reviews + assigns in
// office-today instead of typing every dispatch into HCP from scratch.
//
// Schedule: every 5 minutes in netlify.toml. Idempotent via gmail label
// `Warranty-Multi-Processed` + Xano-side gmail_message_id dedup.

const { google } = require('googleapis');

const XANO_DRAFT_ENDPOINT =
  'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_warranty_email_draft';

const PROCESSED_LABEL = 'Warranty-Multi-Processed';
// 6 per run × every 5 min = 72/hour throughput which clears any
// realistic backlog within an hour while staying safely under Netlify's
// 10s sync timeout (typical run: ~6s for 6 messages).
const MAX_PER_RUN = 6;

// Each sender pattern feeds the same generic capture endpoint. The XS
// endpoint identifies vendor from sender domain.
//
// 2026-06-02 EVENING REVISION:
// - Removed Frontdoor backup — was racing the dedicated AHS poller and
//   creating duplicate captures with no structured data
// - Added explicit subject EXCLUSIONS for known status-update patterns
//   (Allstate "request for updated call status", "failed repair notice",
//   etc.) so the queue isn't flooded with noise
const QUERY =
  '(from:notifications@em.nationalservicealliance.com OR ' +
  'from:appliance_dispatch@squaretrade.com OR ' +
  'from:appliance_team@squaretrade.com OR ' +
  'from:warrantysupport@squaretrade.com) ' +
  '-subject:"request for updated" ' +
  '-subject:"failed repair notice" ' +
  '-subject:"update request" ' +
  '-subject:"reply requested" ' +
  '-subject:"closed dispatch" ' +
  '-label:' + PROCESSED_LABEL + ' ' +
  '-label:AHS-Processed ' +
  'in:anywhere newer_than:7d';

async function resolveOrCreateLabel(gmail, name) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const found = (list.data.labels || []).find((l) => l.name === name);
  if (found) return found.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  return created.data.id;
}

function findPart(parts, mimeType) {
  if (!parts) return null;
  for (const p of parts) {
    if (p.mimeType === mimeType && p.body && p.body.data) return p;
    if (p.parts) {
      const r = findPart(p.parts, mimeType);
      if (r) return r;
    }
  }
  return null;
}

function decodeBase64Url(s) {
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buf.toString('utf8');
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  // Try plain part first, then HTML
  const plain = findPart(payload.parts, 'text/plain');
  if (plain) return decodeBase64Url(plain.body.data);
  const html = findPart(payload.parts, 'text/html');
  if (html) return decodeBase64Url(html.body.data).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').slice(0, 8000);
  return (payload.body && payload.body.data) ? decodeBase64Url(payload.body.data) : '';
}

exports.handler = async () => {
  const startedAt = Date.now();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'gmail_oauth_env_missing' }) };
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  let processedLabelId;
  try {
    processedLabelId = await resolveOrCreateLabel(gmail, PROCESSED_LABEL);
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'label_resolve_failed', message: e.message }) };
  }

  let list;
  try {
    list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: MAX_PER_RUN });
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'gmail_list_failed', message: e.message }) };
  }

  const messages = list.data.messages || [];
  const results = { processed: [], skipped: [], errors: [] };

  for (const m of messages) {
    try {
      const det = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const headers = (det.data.payload && det.data.payload.headers) || [];
      const h = (name) => {
        const f = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
        return f ? f.value : '';
      };
      const subject = h('Subject');
      const sender = h('From');
      const dateHdr = h('Date');
      const body = extractBody(det.data.payload).slice(0, 12000);

      const draftRes = await fetch(XANO_DRAFT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender,
          subject,
          body,
          gmail_message_id: m.id,
          received_at_iso: dateHdr,
        }),
      });
      const draftData = await draftRes.json().catch(() => ({}));

      if (draftRes.ok && draftData && draftData.success) {
        await gmail.users.messages.modify({
          userId: 'me',
          id: m.id,
          requestBody: { addLabelIds: [processedLabelId] },
        });
        results.processed.push({
          id: m.id,
          subject: subject.slice(0, 100),
          warranty_company: draftData.warranty_company,
          skipped: draftData.skipped || false,
          job_id: draftData.job_id,
        });
      } else {
        results.errors.push({ id: m.id, subject: subject.slice(0, 80), xano_status: draftRes.status });
      }
    } catch (e) {
      results.errors.push({ id: m.id, message: e.message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        ok: true,
        elapsed_ms: Date.now() - startedAt,
        query: QUERY,
        found: messages.length,
        processed_count: results.processed.length,
        skipped_count: results.skipped.length,
        error_count: results.errors.length,
        results,
      },
      null,
      2,
    ),
  };
};
