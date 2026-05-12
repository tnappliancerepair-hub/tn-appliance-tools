// AHS dispatch email poller. Scheduled function — runs every 15 minutes
// (see netlify.toml [functions."ahs-gmail-poller"] schedule).
//
// Replaces the original Make.com scenario plan. Native Gmail API access
// avoids two pitfalls discovered in the Make.com path: (1) "raw" Gmail
// content delivered as multipart MIME (not the bare attachment), and
// (2) JSON-escaping the raw email body to fit in {"rawXml": "..."}
// fragile. This function reads the dispatch.xml attachment directly,
// decodes it cleanly, and POSTs to the live Xano ahs_email_intake
// endpoint (verified 16/16 checks 2026-05-11).
//
// Flow per invocation:
//   1. Refresh OAuth access token from stored refresh_token.
//   2. Resolve or create the "AHS-Processed" Gmail label (idempotency
//      marker — we never reprocess a labeled message).
//   3. List messages matching the AHS dispatch fingerprint that don't
//      yet have the label.
//   4. For each message: fetch full payload, walk parts to find the
//      dispatch.xml attachment, fetch attachment body, base64url-decode
//      to UTF-8.
//   5. POST {rawXml: ...} to https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/ahs_email_intake.
//      On 200, apply the "AHS-Processed" label. On non-200, leave the
//      message untouched (will retry next invocation).
//   6. Return a JSON summary of the run (processed count, errors,
//      message IDs).
//
// Required env vars (see docs/gmail-oauth-setup.md):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//
// Scope used by the refresh token: https://www.googleapis.com/auth/gmail.modify
//   (read messages + apply/remove labels; no send, no permanent delete).

const { google } = require('googleapis');

const XANO_ENDPOINT = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/ahs_email_intake';
const GMAIL_QUERY = 'from:noreply@msg.frontdoor.com subject:"New Dispatch Notification" has:attachment -label:AHS-Processed';
const PROCESSED_LABEL_NAME = 'AHS-Processed';
const MAX_MESSAGES_PER_RUN = 25;

exports.handler = async (event) => {
  const startedAt = Date.now();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('[ahs-gmail-poller] missing required env vars');
    return jsonResp(500, {
      ok: false,
      error: 'server misconfigured — GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN required',
    });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  let labelId;
  try {
    labelId = await resolveOrCreateLabel(gmail);
  } catch (e) {
    console.error('[ahs-gmail-poller] label resolution failed:', e.message);
    return jsonResp(500, { ok: false, error: 'label resolution failed: ' + e.message });
  }

  let messageIds;
  try {
    messageIds = await listCandidateMessages(gmail);
  } catch (e) {
    console.error('[ahs-gmail-poller] gmail list failed:', e.message);
    return jsonResp(500, { ok: false, error: 'gmail list failed: ' + e.message });
  }

  console.log(`[ahs-gmail-poller] query="${GMAIL_QUERY}" found ${messageIds.length} candidate messages`);

  const results = {
    processed: [],
    skipped_no_attachment: [],
    skipped_xano_error: [],
    skipped_fetch_error: [],
  };

  for (const id of messageIds) {
    let xml;
    try {
      xml = await fetchDispatchXml(gmail, id);
    } catch (e) {
      console.error(`[ahs-gmail-poller] message ${id} fetch failed:`, e.message);
      results.skipped_fetch_error.push({ id, error: e.message });
      continue;
    }
    if (!xml) {
      console.log(`[ahs-gmail-poller] message ${id} has no dispatch.xml attachment, skipping`);
      results.skipped_no_attachment.push(id);
      continue;
    }

    let xanoStatus;
    let xanoBody;
    try {
      const r = await postToXano(xml);
      xanoStatus = r.status;
      xanoBody = r.body;
    } catch (e) {
      console.error(`[ahs-gmail-poller] message ${id} Xano POST threw:`, e.message);
      results.skipped_xano_error.push({ id, error: e.message });
      continue;
    }

    if (xanoStatus < 200 || xanoStatus >= 300) {
      console.error(`[ahs-gmail-poller] message ${id} Xano returned ${xanoStatus}: ${xanoBody}`);
      results.skipped_xano_error.push({ id, status: xanoStatus, body: xanoBody });
      continue;
    }

    try {
      await applyLabel(gmail, id, labelId);
    } catch (e) {
      // Xano already created the job. Label application failed — log + continue.
      // This could re-process next cycle, but Xano will create a duplicate job
      // (idempotency dedup on claim_number is a deferred Phase 4 task).
      console.error(`[ahs-gmail-poller] message ${id} label apply failed AFTER Xano success:`, e.message);
    }

    let xanoSummary = xanoBody;
    try {
      const parsed = JSON.parse(xanoBody);
      xanoSummary = `job_id=${parsed.job_id} channel=${parsed.consent_channel_used}`;
    } catch (_) {}
    console.log(`[ahs-gmail-poller] message ${id} → Xano 200 (${xanoSummary}), labeled AHS-Processed`);
    results.processed.push({ id, xano: xanoSummary });
  }

  const elapsed = Date.now() - startedAt;
  const summary = {
    ok: true,
    elapsed_ms: elapsed,
    query: GMAIL_QUERY,
    found: messageIds.length,
    processed_count: results.processed.length,
    skipped_counts: {
      no_attachment: results.skipped_no_attachment.length,
      xano_error: results.skipped_xano_error.length,
      fetch_error: results.skipped_fetch_error.length,
    },
    details: results,
  };
  console.log('[ahs-gmail-poller] run summary:', JSON.stringify(summary));
  return jsonResp(200, summary);
};

async function resolveOrCreateLabel(gmail) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const existing = (list.data.labels || []).find((l) => l.name === PROCESSED_LABEL_NAME);
  if (existing) return existing.id;

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: PROCESSED_LABEL_NAME,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  console.log(`[ahs-gmail-poller] created label ${PROCESSED_LABEL_NAME} (id ${created.data.id})`);
  return created.data.id;
}

async function listCandidateMessages(gmail) {
  const resp = await gmail.users.messages.list({
    userId: 'me',
    q: GMAIL_QUERY,
    maxResults: MAX_MESSAGES_PER_RUN,
  });
  return (resp.data.messages || []).map((m) => m.id);
}

async function fetchDispatchXml(gmail, messageId) {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const attachment = findXmlAttachment(msg.data.payload);
  if (!attachment) return null;

  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachment.attachmentId,
  });
  // Gmail returns base64url-encoded data. Buffer.from('...', 'base64url') decodes natively.
  const xml = Buffer.from(att.data.data, 'base64url').toString('utf8');
  return xml;
}

function findXmlAttachment(payload) {
  if (!payload) return null;
  const parts = collectParts(payload);
  for (const p of parts) {
    if (!p.body || !p.body.attachmentId) continue;
    const filename = (p.filename || '').toLowerCase();
    const mime = (p.mimeType || '').toLowerCase();
    if (filename.endsWith('.xml') || mime === 'application/xml' || mime === 'text/xml') {
      return { attachmentId: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType };
    }
  }
  return null;
}

function collectParts(payload, acc = []) {
  acc.push(payload);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) collectParts(part, acc);
  }
  return acc;
}

async function postToXano(rawXml) {
  const resp = await fetch(XANO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawXml }),
  });
  const body = await resp.text();
  return { status: resp.status, body };
}

async function applyLabel(gmail, messageId, labelId) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
}

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
