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
const { parseAhsPayment, classifyAhsSubject } = require('./_lib/parsers/ahs-payment');

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const XANO_ENDPOINT = `${XANO_BASE}/ahs_email_intake`;           // dispatch flow (legacy)
const XANO_PAYMENT_ENDPOINT = `${XANO_BASE}/ahs_payment_intake`; // payment flow (2026-05-15)

// 2026-05-15: widened from `subject:"New Dispatch Notification" has:attachment`
// so payment / remittance emails (no attachment) also surface. Subject
// classification routes per-message inside the loop.
// Multi-layered safety net so Danielle's manual deletes can't race the poll:
// - 'warranty-companies' label is auto-applied by Gmail filter on every incoming AHS/SP/SquareTrade dispatch
// - 'in:anywhere' means we search Trash + Spam + All Mail (not just Inbox), so a delete moving the email to Trash doesn't hide it
// - 'newer_than:7d' caps lookback to avoid re-processing old archive
const GMAIL_QUERY = '(from:noreply@msg.frontdoor.com OR label:"warranty-companies") in:anywhere -label:AHS-Processed -label:AHS-Processing newer_than:7d';
const PROCESSED_LABEL_NAME = 'AHS-Processed';
// Two-phase claim label introduced 2026-05-11 after parallel "Run now" double-click
// created duplicate jobs in production (request ids cd08e69f + a46731eb both
// processed the same Gmail messages because list-to-label-apply window allowed
// the second invocation to see them as unprocessed). The claim label is applied
// IMMEDIATELY after list (before the Xano POST) so a parallel invocation's
// query — which excludes both labels — won't see them. Window-narrowing fix,
// not atomic mutex (Gmail modify isn't a conditional CAS). Two truly-simultaneous
// invocations could still race the list→claim window (~150ms vs the prior
// ~POST-duration window of seconds). If duplicates recur under this fix,
// escalate to Xano-side gmail_message_id uniqueness check.
const IN_PROGRESS_LABEL_NAME = 'AHS-Processing';
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

  let processedLabelId;
  let inProgressLabelId;
  try {
    processedLabelId = await resolveOrCreateLabel(gmail, PROCESSED_LABEL_NAME);
    inProgressLabelId = await resolveOrCreateLabel(gmail, IN_PROGRESS_LABEL_NAME);
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

  // Phase 1: claim each candidate by applying AHS-Processing IMMEDIATELY,
  // before any per-message processing. Parallel invocations exclude this
  // label in their list query, so the claim narrows the race window from
  // ~POST-duration (seconds) to ~Gmail-modify-call-duration (~150ms).
  const claimed = [];
  for (const id of messageIds) {
    try {
      await applyLabels(gmail, id, [inProgressLabelId]);
      claimed.push(id);
    } catch (e) {
      console.error(`[ahs-gmail-poller] message ${id} claim failed, skipping this run:`, e.message);
    }
  }

  const results = {
    processed: [],
    skipped_no_attachment: [],
    skipped_xano_error: [],
    skipped_fetch_error: [],
    skipped_claim_failed: messageIds.filter((id) => !claimed.includes(id)),
  };

  // Phase 2: process each claimed message. On Xano success, swap labels
  // (apply AHS-Processed + remove AHS-Processing). On any failure path,
  // remove the AHS-Processing claim so the message retries next cycle.
  //
  // 2026-05-15: subject-classification router. Frontdoor/AHS sends
  // dispatch emails AND payment remittance emails from the same address.
  // Dispatch path uses the existing XML-attachment flow. Payment path
  // reads the plaintext body and POSTs to ahs_payment_intake.
  for (const id of claimed) {
    let baseMsg;
    try {
      baseMsg = await fetchMessage(gmail, id);
    } catch (e) {
      console.error(`[ahs-gmail-poller] message ${id} fetch failed:`, e.message);
      results.skipped_fetch_error.push({ id, error: e.message });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    const subjectClass = classifyAhsSubject(baseMsg.subject);
    const isPayment = subjectClass === 'payment';
    const isDispatch = subjectClass === 'dispatch';

    // Always log the subject + sender + class so we can SEE what the
    // poller is finding. This is the diagnostic surface we need to
    // catch label-mismatch + format-change problems early.
    if (!results.skipped_subjects) results.skipped_subjects = [];
    results.skipped_subjects.push({
      id,
      subject: (baseMsg.subject || '').slice(0, 120),
      sender: (baseMsg.sender || '').slice(0, 80),
      class: subjectClass,
    });

    // Skip 'unknown' classes cleanly — neither dispatch nor payment.
    // Used to fall through to dispatch branch + fail on no-attachment,
    // which masked the real problem (label matching wrong emails).
    if (subjectClass === 'unknown') {
      console.log(`[ahs-gmail-poller] message ${id} class=unknown subject="${(baseMsg.subject || '').slice(0,80)}" — skipping`);
      results.skipped_no_attachment.push(id);
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    let xanoStatus;
    let xanoBody;
    let xanoEndpoint;
    let xanoPayload;

    try {
      if (isPayment) {
        // Payment branch — parse plaintext body, POST to payment intake.
        const body = baseMsg.body || '';
        if (!body) {
          console.log(`[ahs-gmail-poller] message ${id} payment but no body, skipping`);
          results.skipped_no_attachment.push(id);
          await releaseClaim(gmail, id, inProgressLabelId);
          continue;
        }
        const parsed = parseAhsPayment(body);
        xanoEndpoint = XANO_PAYMENT_ENDPOINT;
        xanoPayload = {
          gmail_message_id: id,
          gmail_thread_id: baseMsg.threadId,
          sender: baseMsg.sender,
          subject: baseMsg.subject,
          payload_json: JSON.stringify(parsed),
          received_at_ms: baseMsg.receivedAtMs,
        };
      } else {
        // Dispatch branch — XML attachment required (legacy flow).
        const att = findXmlAttachment(baseMsg.payload);
        if (!att) {
          console.log(`[ahs-gmail-poller] message ${id} class=${subjectClass} has no dispatch.xml attachment, skipping`);
          results.skipped_no_attachment.push(id);
          await releaseClaim(gmail, id, inProgressLabelId);
          continue;
        }
        const attResp = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: id,
          id: att.attachmentId,
        });
        const xml = Buffer.from(attResp.data.data, 'base64url').toString('utf8');
        xanoEndpoint = XANO_ENDPOINT;
        xanoPayload = {
          rawXml: xml,
          gmail_message_id: id,
          gmail_thread_id: baseMsg.threadId,
          sender: baseMsg.sender,
          subject: baseMsg.subject,
          received_at_ms: baseMsg.receivedAtMs,
        };
      }

      const r = await postToXano(xanoPayload, xanoEndpoint);
      xanoStatus = r.status;
      xanoBody = r.body;
    } catch (e) {
      console.error(`[ahs-gmail-poller] message ${id} processing threw (class=${subjectClass}):`, e.message);
      results.skipped_xano_error.push({ id, error: e.message });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    if (xanoStatus < 200 || xanoStatus >= 300) {
      console.error(`[ahs-gmail-poller] message ${id} Xano returned ${xanoStatus}: ${xanoBody}`);
      results.skipped_xano_error.push({ id, status: xanoStatus, body: xanoBody });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    // Finalize: apply Processed, remove Processing (single Gmail call).
    try {
      await modifyLabels(gmail, id, [processedLabelId], [inProgressLabelId]);
    } catch (e) {
      // Xano already created the job. Label swap failed — log + continue.
      // The message keeps the AHS-Processing label; next invocation's query
      // excludes -label:AHS-Processing so the message won't be re-fetched
      // until a manual cleanup removes the stale claim. Better than the
      // pre-fix behavior where label apply failure could cause re-processing.
      console.error(`[ahs-gmail-poller] message ${id} label swap failed AFTER Xano success:`, e.message);
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
    claimed_count: claimed.length,
    processed_count: results.processed.length,
    skipped_counts: {
      no_attachment: results.skipped_no_attachment.length,
      xano_error: results.skipped_xano_error.length,
      fetch_error: results.skipped_fetch_error.length,
      claim_failed: results.skipped_claim_failed.length,
    },
    details: results,
  };
  console.log('[ahs-gmail-poller] run summary:', JSON.stringify(summary));
  return jsonResp(200, summary);
};

async function resolveOrCreateLabel(gmail, labelName) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const existing = (list.data.labels || []).find((l) => l.name === labelName);
  if (existing) return existing.id;

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  console.log(`[ahs-gmail-poller] created label ${labelName} (id ${created.data.id})`);
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

// Generic message fetcher — returns headers, plaintext body, and the
// full payload (so the dispatch branch can search for the XML
// attachment, while the payment branch reads body).
async function fetchMessage(gmail, messageId) {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const headers = ((msg.data.payload || {}).headers || []).reduce((acc, h) => {
    acc[h.name.toLowerCase()] = h.value;
    return acc;
  }, {});
  // Gmail internalDate is milliseconds since epoch (string from API). Used by
  // the forward-only PARSER_ACTIVATION_TS_MS gate on the Xano side to skip
  // pre-activation backlog without re-fetching.
  const receivedAtMs = parseInt(msg.data.internalDate || '0', 10) || 0;
  return {
    payload: msg.data.payload,
    threadId: msg.data.threadId || '',
    sender: headers.from || '',
    subject: headers.subject || '',
    body: extractTextBody(msg.data.payload),
    receivedAtMs,
  };
}

// Walk parts, prefer text/plain; fall back to text/html with tags stripped.
function extractTextBody(payload) {
  if (!payload) return '';
  const parts = collectParts(payload);
  let plain = '';
  let html = '';
  for (const p of parts) {
    const mime = (p.mimeType || '').toLowerCase();
    const data = p.body && p.body.data ? Buffer.from(p.body.data, 'base64url').toString('utf8') : '';
    if (!data) continue;
    if (mime === 'text/plain' && !plain) plain = data;
    else if (mime === 'text/html' && !html) html = data;
  }
  if (plain) return plain;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
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

async function postToXano(payload, endpoint = XANO_ENDPOINT) {
  // payload: { rawXml, gmail_message_id, gmail_thread_id, sender, subject }
  // gmail_message_id is the idempotency anchor — backward-port of the
  // ServicePower smart-dedup pattern. Xano endpoint short-circuits if a
  // job_email_event row already exists for this gmail_message_id.
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await resp.text();
  return { status: resp.status, body };
}

async function applyLabels(gmail, messageId, addLabelIds) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds },
  });
}

async function modifyLabels(gmail, messageId, addLabelIds, removeLabelIds) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
}

// Best-effort claim release on any per-message failure path. Logs the error
// but never throws — we don't want a label-release failure to mask the
// underlying processing failure in the caller. Worst case: a stale
// AHS-Processing label sticks until manual cleanup, blocking that one
// message from retrying.
async function releaseClaim(gmail, messageId, inProgressLabelId) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: [inProgressLabelId] },
    });
  } catch (e) {
    console.error(`[ahs-gmail-poller] message ${messageId} claim release failed:`, e.message);
  }
}

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
