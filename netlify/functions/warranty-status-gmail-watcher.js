// Warranty-status email watcher. Scheduled Netlify fn that scans Gmail
// for vendor confirmation / payment / denial emails and auto-updates
// warranty_submissions via record_warranty_submission. Phase 0 of the
// warranty-portal automation arc — works without any vendor portal
// scraping or API access.
//
// SAFETY: defaults to DRY-RUN mode. In dry-run, the function PARSES + LOGS
// what it WOULD have submitted (as event_log rows for Teddy to inspect)
// but doesn't actually call record_warranty_submission. Flip live by
// setting WARRANTY_STATUS_WATCHER_LIVE=true in Netlify env.
//
// Patterns are conservative + multi-vendor — Teddy can review the dry-run
// event_log rows, tune patterns, then flip live with confidence.
//
// Recognized email types (best-effort matching):
//   - "Claim XXX has been received / submitted / confirmed"  → status=submitted
//   - "Payment of $XX issued for claim XXX"                  → status=paid
//   - "Claim XXX has been denied / rejected"                 → status=denied
//
// Required env vars (same as other Gmail pollers):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//
// Optional:
//   WARRANTY_STATUS_WATCHER_LIVE=true   — exit dry-run, actually update DB
//   WARRANTY_STATUS_WATCHER_MAX=25      — messages per run (default 25)

const { google } = require('googleapis');

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const RECORD_ENDPOINT = `${XANO_BASE}/record_warranty_submission`;
const EVENT_LOG_ENDPOINT = `${XANO_BASE}/record_event_log`;

const PROCESSED_LABEL = 'Ant-Status-Processed';
const PARSED_LABEL = 'Ant-Status-Parsed';

const MAX_MESSAGES_PER_RUN = Number(process.env.WARRANTY_STATUS_WATCHER_MAX || 25);
const IS_LIVE = String(process.env.WARRANTY_STATUS_WATCHER_LIVE || 'false').toLowerCase() === 'true';

// Gmail query — wide net, then per-message classification.
// `label:"warranty-companies"` is the same auto-applied filter Teddy
// has set up; in:anywhere catches Trash/Spam; newer_than:14d caps lookback.
const GMAIL_QUERY = `label:"warranty-companies" in:anywhere -label:"${PROCESSED_LABEL}" -label:"${PARSED_LABEL}" newer_than:14d`;

// Vendor identification by sender domain. First-match wins.
const VENDOR_DOMAINS = [
  { needle: 'frontdoor.com',   vendor: 'ahs' },
  { needle: 'ahs.com',         vendor: 'ahs' },
  { needle: 'servicepower.com', vendor: 'servicepower' },
  { needle: 'squaretrade.com',  vendor: 'squaretrade' },
  { needle: 'allstateprotection', vendor: 'allstate' },
  { needle: 'nsahomewarranty',  vendor: 'nsa' },
];

// Subject-line classifiers. Order matters — denied/paid checked before
// the broader "received/submitted" so we don't misclassify a "Payment
// of $X for claim Y received" as just 'submitted'.
const STATUS_RULES = [
  { test: /\bdenied?\b|\brejected?\b|\bnot approved\b/i,                   status: 'denied' },
  { test: /\bpaid\b|\bpayment\b|\breimbursement\b|\bremittance\b/i,        status: 'paid' },
  { test: /\bsubmitted\b|\breceived\b|\bconfirmed\b|\bdispatched\b/i,      status: 'submitted' },
  { test: /\bfailed\b|\berror\b|\bunable to process\b/i,                   status: 'failed' },
];

// Claim # extractor — accept alphanumeric strings 5-14 chars. Loose by
// design; if we extract a wrong "claim #" we still log + dry-run, never
// silently flip status without Teddy review.
const CLAIM_PATTERNS = [
  /claim\s*(?:#|number|no\.?)?\s*[:\-]?\s*([A-Z0-9\-]{5,14})/i,
  /confirmation\s*(?:#|number|no\.?)?\s*[:\-]?\s*([A-Z0-9\-]{5,14})/i,
  /dispatch\s*(?:#|number|no\.?|id)?\s*[:\-]?\s*([A-Z0-9\-]{5,14})/i,
  /reference\s*(?:#|number|no\.?)?\s*[:\-]?\s*([A-Z0-9\-]{5,14})/i,
];

const AMOUNT_PATTERN = /\$\s*([0-9]{1,5}(?:[,.][0-9]{2,3})?(?:\.[0-9]{2})?)/;

exports.handler = async (event) => {
  const startedAt = Date.now();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return jsonResp(500, { ok: false, error: 'missing GMAIL_* env vars' });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  let parsedLabelId, processedLabelId;
  try {
    parsedLabelId = await resolveOrCreateLabel(gmail, PARSED_LABEL);
    processedLabelId = await resolveOrCreateLabel(gmail, PROCESSED_LABEL);
  } catch (e) {
    return jsonResp(500, { ok: false, error: 'label resolution failed: ' + e.message });
  }

  let list;
  try {
    list = await gmail.users.messages.list({
      userId: 'me',
      q: GMAIL_QUERY,
      maxResults: MAX_MESSAGES_PER_RUN,
    });
  } catch (e) {
    return jsonResp(500, { ok: false, error: 'gmail list failed: ' + e.message });
  }

  const msgIds = (list.data.messages || []).map((m) => m.id);
  if (msgIds.length === 0) {
    return jsonResp(200, { ok: true, mode: IS_LIVE ? 'live' : 'dry_run', processed: 0, msg: 'no candidate emails' });
  }

  const results = [];
  for (const id of msgIds) {
    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const parsed = parseMessage(msg.data);
      const matched = await maybeRecord(parsed);
      results.push({ id, ...parsed.summary, matched });
      // Always label as parsed (so we don't re-process). If recorded live,
      // also label as processed (terminal).
      const labels = [parsedLabelId];
      if (matched.recorded) labels.push(processedLabelId);
      await gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: labels } });
    } catch (e) {
      results.push({ id, error: e.message });
    }
  }

  return jsonResp(200, {
    ok: true,
    mode: IS_LIVE ? 'live' : 'dry_run',
    processed: results.length,
    elapsed_ms: Date.now() - startedAt,
    results,
  });
};

function parseMessage(msgData) {
  const headers = (msgData.payload?.headers || []).reduce((acc, h) => {
    acc[h.name.toLowerCase()] = h.value || '';
    return acc;
  }, {});
  const subject = headers['subject'] || '';
  const from = headers['from'] || '';
  const snippet = msgData.snippet || '';
  const body = extractBody(msgData.payload || {});
  const haystack = `${subject}\n${snippet}\n${body}`;

  // Vendor
  const fromLower = from.toLowerCase();
  let vendor = '';
  for (const v of VENDOR_DOMAINS) {
    if (fromLower.includes(v.needle)) { vendor = v.vendor; break; }
  }

  // Status (first-match-wins, denied/paid before submitted)
  let status = '';
  for (const r of STATUS_RULES) {
    if (r.test.test(haystack)) { status = r.status; break; }
  }

  // Claim number — try patterns until one hits
  let claim = '';
  for (const re of CLAIM_PATTERNS) {
    const m = haystack.match(re);
    if (m && m[1]) { claim = m[1].toUpperCase(); break; }
  }

  // Amount (only if status is paid)
  let amount = 0;
  if (status === 'paid') {
    const m = haystack.match(AMOUNT_PATTERN);
    if (m && m[1]) amount = parseFloat(m[1].replace(/,/g, ''));
  }

  return {
    summary: { subject, from, vendor, status, claim, amount },
    body,
  };
}

function extractBody(part) {
  if (!part) return '';
  if (part.body?.data) {
    try { return Buffer.from(part.body.data, 'base64url').toString('utf-8'); }
    catch (_) { return ''; }
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const b = extractBody(sub);
      if (b) return b;
    }
  }
  return '';
}

async function maybeRecord({ summary }) {
  // Need vendor + status + claim — anything less is an inconclusive parse,
  // surface as dry-run regardless of LIVE flag.
  const inconclusive = !summary.vendor || !summary.status || !summary.claim;
  const action = inconclusive ? 'warranty_status_watcher_inconclusive' : 'warranty_status_watcher_parsed';

  // Always log the parse outcome to event_log for review.
  try {
    await fetch(EVENT_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        metadata_json: JSON.stringify({
          ...summary,
          mode: IS_LIVE ? 'live' : 'dry_run',
        }),
      }),
    });
  } catch (_) {}

  if (inconclusive) return { recorded: false, reason: 'inconclusive_parse' };
  if (!IS_LIVE)     return { recorded: false, reason: 'dry_run' };

  // Live path: resolve claim_number → job_id, then update submission.
  let jobId = 0;
  try {
    const lookupUrl = `${XANO_BASE}/find_job_by_claim_number?claim_number=${encodeURIComponent(summary.claim)}` +
      (summary.vendor ? `&vendor=${encodeURIComponent(summary.vendor)}` : '');
    const lookupRes = await fetch(lookupUrl);
    const lookupData = await lookupRes.json();
    jobId = (lookupData && lookupData.best && lookupData.best.job_id) || 0;
    if (lookupData.count > 1) {
      // Multiple candidates — DON'T auto-update. Log + bail so Teddy can pick.
      await fetch(EVENT_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'warranty_status_watcher_ambiguous_claim',
          metadata_json: JSON.stringify({ ...summary, candidates: lookupData.candidates }),
        }),
      });
      return { recorded: false, reason: 'ambiguous_claim_match', candidates: lookupData.count };
    }
  } catch (e) {
    return { recorded: false, reason: 'lookup_failed', error: e.message };
  }

  if (!jobId) return { recorded: false, reason: 'no_job_for_claim' };

  try {
    const r = await fetch(RECORD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        confirmation_id: summary.claim,
        vendor: summary.vendor,
        status: summary.status,
        submission_method: 'email',
        paid_amount: summary.amount || 0,
        submitted_by: 'gmail_watcher',
        notes: `auto-classified from email: "${(summary.subject || '').slice(0,120)}"`,
      }),
    });
    const d = await r.json();
    return { recorded: !!d.success, reason: d.success ? 'updated' : (d.message || 'record_failed'), job_id: jobId };
  } catch (e) {
    return { recorded: false, reason: 'record_failed', error: e.message };
  }
}

async function resolveOrCreateLabel(gmail, name) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const found = (list.data.labels || []).find((l) => l.name === name);
  if (found) return found.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return created.data.id;
}

function jsonResp(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
