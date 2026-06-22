// ServicePower dispatch email poller. Phase A1 parallel poller — clean
// clone of ahs-gmail-poller.js with ServicePower-specific values. Per
// Phase A1 architecture decisions (Option B file structure): defer the
// Option C consolidation (warranty-gmail-poller.js with handler registry)
// until AHS duplicate-jobs investigation closes. Sharing this OAuth /
// label / error handling code with AHS is the Phase B refactor target.
//
// ─── SCHEDULE STATUS ───────────────────────────────────────────────
// Schedule is COMMENTED OUT in netlify.toml until Teddy explicitly
// approves enabling it. This file is deployable and manually fireable
// via the Netlify dashboard "Test" / "Run now" button. The cron line
// will only be uncommented after offline parser verification and a
// successful manual fire against one real Gmail message.
//
// ─── FLOW (mirrors AHS poller) ─────────────────────────────────────
//   1. Refresh OAuth from stored refresh_token
//   2. Resolve or create ServicePower-Processed + ServicePower-Processing labels
//   3. messages.list with query that excludes BOTH labels
//   4. Phase 1: apply ServicePower-Processing label to each candidate (claim)
//   5. Phase 2 per claimed message:
//        a. messages.get full body
//        b. Walk parts, prefer text/plain (ServicePower emails ARE plain text)
//        c. Parse body via _lib/parsers/servicepower.js → { email_type, dispatches[] }
//        d. POST structured payload to Xano servicepower_email_intake
//        e. On Xano success: swap labels (apply Processed, remove Processing)
//        f. On any failure: release Processing claim (allow retry next cycle)
//   6. Return JSON summary
//
// ─── DUPLICATE-FIRE MITIGATION ─────────────────────────────────────
// Two-phase claim label pattern (mirror of AHS commit 69fbd22) — narrows
// the race window from ~POST-duration (seconds) to ~Gmail-modify-call-
// duration (~150ms). Not atomic mutex. The Xano endpoint also dedups by
// gmail_message_id (UNIQUE constraint on job_email_event), so even if
// the label race fires, the Xano side will treat the second invocation
// as a duplicate and no-op cleanly.
//
// ─── REQUIRED ENV VARS ─────────────────────────────────────────────
//   GMAIL_CLIENT_ID
//   GMAIL_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN
//   (No Xano-side auth needed — servicepower_email_intake endpoint is
//    public same as ahs_email_intake; deferred to Phase B hardening.)
//
// Scope used: https://www.googleapis.com/auth/gmail.modify

const { google } = require('googleapis');
const { parseServicePowerBody } = require('./_lib/parsers/servicepower');
const {
  parseServicePowerPayment,
  classifyServicePowerSubject,
} = require('./_lib/parsers/servicepower-payment');

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const XANO_ENDPOINT = `${XANO_BASE}/servicepower_email_intake`;          // dispatch flow (legacy)
const XANO_PAYMENT_ENDPOINT = `${XANO_BASE}/squaretrade_payment_intake`; // payment flow (2026-05-15)

// Gmail query — broadened 2026-05-15 to also capture payment / remittance
// emails. Both dispatch AND payment emails come from the same ServicePower
// sender; classification happens inside the per-message loop based on the
// Subject header. Excludes both labels to keep the claim window narrow.
// Multi-layered safety net so Danielle's manual deletes can't race the poll.
// See ahs-gmail-poller.js header for the same rationale.
const GMAIL_QUERY = '((from:noreply@servicepower.com OR from:NOREPLY@servicepower.com) OR label:"warranty-companies") in:anywhere -label:ServicePower-Processed -label:ServicePower-Processing newer_than:7d';
const PROCESSED_LABEL_NAME = 'ServicePower-Processed';
const IN_PROGRESS_LABEL_NAME = 'ServicePower-Processing';
const MAX_MESSAGES_PER_RUN = 25;

exports.handler = async (event) => {
  const startedAt = Date.now();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('[servicepower-gmail-poller] missing required env vars');
    return jsonResp(500, {
      ok: false,
      error: 'server misconfigured — GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN required',
    });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  let processedLabelId, inProgressLabelId;
  try {
    processedLabelId = await resolveOrCreateLabel(gmail, PROCESSED_LABEL_NAME);
    inProgressLabelId = await resolveOrCreateLabel(gmail, IN_PROGRESS_LABEL_NAME);
  } catch (e) {
    console.error('[servicepower-gmail-poller] label resolution failed:', e.message);
    return jsonResp(500, { ok: false, error: 'label resolution failed: ' + e.message });
  }

  let messageIds;
  try {
    messageIds = await listCandidateMessages(gmail);
  } catch (e) {
    console.error('[servicepower-gmail-poller] gmail list failed:', e.message);
    return jsonResp(500, { ok: false, error: 'gmail list failed: ' + e.message });
  }
  console.log(`[servicepower-gmail-poller] query="${GMAIL_QUERY}" found ${messageIds.length} candidate messages`);

  // Phase 1: claim each candidate (apply In-Progress label) BEFORE processing.
  const claimed = [];
  for (const id of messageIds) {
    try {
      await applyLabels(gmail, id, [inProgressLabelId]);
      claimed.push(id);
    } catch (e) {
      console.error(`[servicepower-gmail-poller] message ${id} claim failed, skipping:`, e.message);
    }
  }

  const results = {
    processed: [],
    skipped_no_body: [],
    skipped_parse_failed: [],
    skipped_xano_error: [],
    skipped_fetch_error: [],
    skipped_claim_failed: messageIds.filter((id) => !claimed.includes(id)),
  };

  // Phase 2: process each claimed message.
  for (const id of claimed) {
    let msg;
    try {
      msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    } catch (e) {
      console.error(`[servicepower-gmail-poller] message ${id} fetch failed:`, e.message);
      results.skipped_fetch_error.push({ id, error: e.message });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    const headers = ((msg.data.payload || {}).headers || []).reduce((acc, h) => {
      acc[h.name.toLowerCase()] = h.value;
      return acc;
    }, {});
    const subject = headers.subject || '';
    const sender = headers.from || '';
    const threadId = msg.data.threadId || '';
    // For PARSER_ACTIVATION_TS_MS forward-only gate on the Xano side.
    const receivedAtMs = parseInt(msg.data.internalDate || '0', 10) || 0;

    const body = extractTextBody(msg.data.payload);
    if (!body) {
      console.log(`[servicepower-gmail-poller] message ${id} has no plaintext body, skipping`);
      results.skipped_no_body.push(id);
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    // ─── CLASSIFY ─────────────────────────────────────────────────
    // 2026-05-15: subject-based router. ServicePower sends dispatch
    // emails AND payment remittance emails from the same address. The
    // poller fans them out to two different Xano endpoints.
    const subjectClass = classifyServicePowerSubject(subject);
    const isPayment = subjectClass === 'payment';

    // Always log subject + class to results for diagnostic visibility
    if (!results.skipped_subjects) results.skipped_subjects = [];
    results.skipped_subjects.push({
      id,
      subject: (subject || '').slice(0, 120),
      sender: (sender || '').slice(0, 80),
      class: subjectClass,
    });

    // Skip status_update + unknown cleanly — label processed, don't
    // try to call any Xano endpoint. Same fix as AHS poller.
    if (subjectClass === 'status_update' || subjectClass === 'unknown') {
      console.log(`[servicepower-gmail-poller] message ${id} class=${subjectClass} subject="${(subject || '').slice(0,80)}" — labeling processed and skipping`);
      if (!results.skipped_status) results.skipped_status = [];
      results.skipped_status.push({ id, class: subjectClass, subject: (subject || '').slice(0, 100) });
      try { await labelMsg(gmail, id, processedLabelId); } catch (_) {}
      try { await releaseClaim(gmail, id, inProgressLabelId); } catch (_) {}
      continue;
    }

    let parsed;
    let xanoEndpoint;
    let xanoPayload;

    try {
      if (isPayment) {
        // Payment / remittance flow → squaretrade_payment_intake.
        parsed = parseServicePowerPayment(body);
        xanoEndpoint = XANO_PAYMENT_ENDPOINT;
        xanoPayload = {
          gmail_message_id: id,
          gmail_thread_id: threadId,
          sender,
          subject,
          // payload_json: XanoScript requires schema blocks for object
          // inputs; we stringify and json_decode on the Xano side.
          payload_json: JSON.stringify(parsed),
          received_at_ms: receivedAtMs,
        };
      } else {
        // Dispatch flow (existing) → servicepower_email_intake.
        parsed = parseServicePowerBody(body, subject);
        xanoEndpoint = XANO_ENDPOINT;
        xanoPayload = {
          gmail_message_id: id,
          gmail_thread_id: threadId,
          sender,
          subject,
          email_type: parsed.email_type,
          dispatches_json: JSON.stringify(parsed.dispatches),
          body_excerpt: body.slice(0, 500),
          received_at_ms: receivedAtMs,
        };
        // Multi-item capture — when a dispatch lists 2+ appliances (Item/Product
        // labels), log the raw body so we can wire the auto-split (one claim → one
        // job per appliance) against the REAL format. Danielle, 2026-06-22: a 2nd
        // appliance on one claim was being dropped. Fires only on multi-item; truncated.
        try {
          const itemHits = (body.match(/^\s*(Item|Product)\s*[:\-]/gim) || []).length;
          if (itemHits >= 2) {
            await fetch(`${XANO_BASE}/record_event_log`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'dispatch_raw_capture', metadata_json: JSON.stringify({ subject, item_hits: itemHits, parsed_dispatches: (parsed.dispatches || []).length, body: body.slice(0, 4000) }) }),
            });
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error(`[servicepower-gmail-poller] message ${id} parser threw (class=${subjectClass}):`, e.message);
      results.skipped_parse_failed.push({ id, error: e.message, class: subjectClass });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    let xanoStatus, xanoBody;
    try {
      const r = await postToXano(xanoPayload, xanoEndpoint);
      xanoStatus = r.status;
      xanoBody = r.body;
    } catch (e) {
      console.error(`[servicepower-gmail-poller] message ${id} Xano POST threw:`, e.message);
      results.skipped_xano_error.push({ id, error: e.message });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    if (xanoStatus < 200 || xanoStatus >= 300) {
      console.error(`[servicepower-gmail-poller] message ${id} Xano returned ${xanoStatus}: ${xanoBody}`);
      results.skipped_xano_error.push({ id, status: xanoStatus, body: xanoBody });
      await releaseClaim(gmail, id, inProgressLabelId);
      continue;
    }

    // Finalize: apply Processed + remove Processing in a single Gmail call.
    try {
      await modifyLabels(gmail, id, [processedLabelId], [inProgressLabelId]);
    } catch (e) {
      // Xano already processed. Label swap failed — log but continue.
      // The message keeps Processing label so it won't be re-fetched.
      console.error(`[servicepower-gmail-poller] message ${id} label swap failed AFTER Xano success:`, e.message);
    }

    let summary = xanoBody;
    try {
      const parsedResp = JSON.parse(xanoBody);
      if (isPayment) {
        summary = `class=payment batch=${parsedResp.batch_id ?? '?'} total=${parsedResp.total ?? '?'} matched=${parsedResp.matched_count ?? 0} unmatched=${parsedResp.unmatched_count ?? 0} disputed=${parsedResp.disputed_count ?? 0}`;
      } else {
        summary = `class=dispatch email_type=${parsed.email_type} dispatches=${parsed.dispatches.length} actions=${(parsedResp.actions || []).map(a => a.action).join(',')}`;
      }
    } catch (_) {}
    console.log(`[servicepower-gmail-poller] message ${id} → Xano 200 (${summary}), labeled ServicePower-Processed`);
    results.processed.push({
      id,
      xano: summary,
      class: isPayment ? 'payment' : 'dispatch',
      ...(isPayment
        ? { confidence: parsed.format_confidence, line_count: parsed.lines.length }
        : { email_type: parsed.email_type, dispatch_count: parsed.dispatches.length }),
    });
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
      no_body: results.skipped_no_body.length,
      parse_failed: results.skipped_parse_failed.length,
      xano_error: results.skipped_xano_error.length,
      fetch_error: results.skipped_fetch_error.length,
      claim_failed: results.skipped_claim_failed.length,
    },
    details: results,
  };
  console.log('[servicepower-gmail-poller] run summary:', JSON.stringify(summary));
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
  console.log(`[servicepower-gmail-poller] created label ${labelName} (id ${created.data.id})`);
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

// Walk parts, prefer text/plain. ServicePower emails arrive as plaintext
// (verified in the 2026-05-12 landscape survey), so the HTML fallback
// is defensive only.
function extractTextBody(payload) {
  if (!payload) return '';
  const parts = collectParts(payload);
  // First pass: text/plain
  for (const p of parts) {
    if ((p.mimeType || '').toLowerCase() === 'text/plain' && p.body && p.body.data) {
      return Buffer.from(p.body.data, 'base64url').toString('utf8');
    }
  }
  // Fallback: text/html (strip tags)
  for (const p of parts) {
    if ((p.mimeType || '').toLowerCase() === 'text/html' && p.body && p.body.data) {
      const html = Buffer.from(p.body.data, 'base64url').toString('utf8');
      return htmlToText(html);
    }
  }
  return '';
}

function collectParts(payload, acc = []) {
  acc.push(payload);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) collectParts(part, acc);
  }
  return acc;
}

function htmlToText(s) {
  return (s || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function postToXano(payload, endpoint = XANO_ENDPOINT) {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await resp.text();
  return { status: resp.status, body };
}

async function applyLabels(gmail, messageId, addLabelIds) {
  await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds } });
}

async function modifyLabels(gmail, messageId, addLabelIds, removeLabelIds) {
  await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds, removeLabelIds } });
}

// Best-effort claim release. Never throws — a release failure must not
// mask the underlying processing failure. Worst case: a stale Processing
// label sticks until manual cleanup, blocking that one message from retrying.
async function releaseClaim(gmail, messageId, inProgressLabelId) {
  try {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: [inProgressLabelId] } });
  } catch (e) {
    console.error(`[servicepower-gmail-poller] message ${messageId} claim release failed:`, e.message);
  }
}

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
