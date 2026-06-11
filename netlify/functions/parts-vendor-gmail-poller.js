// Parts-vendor email poller. Scheduled function — runs every 30 minutes.
//
// Watches the same Gmail inbox the AHS / ServicePower pollers use for
// shipping-confirmation + delivery-notification emails from parts
// distributors (Marcone, Tribles Appliance Parts, Reliable Parts, Amazon Business)
// and carriers (FedEx, UPS, USPS). When a "DELIVERED" message lands,
// extracts identifying details (vendor, tracking #, order #, customer
// hint, zip) and POSTs to /record_parts_delivery_observation.
//
// The downstream parts_delivery_observation_handler.js agent matches
// it against the open awaiting_parts queue and either auto-fires
// mark_parts_arrived (single confident match) or escalates to Teddy
// with candidates.
//
// Pattern mirrors ahs-gmail-poller.js so OAuth refresh + label-based
// idempotency are shared. Required env vars:
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//
// IMPORTANT: this function is INERT until at least one vendor / carrier
// fingerprint matches an inbox message. It is safe to deploy + schedule
// before fingerprints are tuned — it will simply log "no candidates"
// each run and apply no labels.

const { google } = require('googleapis');

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const XANO_ENDPOINT = `${XANO_BASE}/record_parts_delivery_observation`;
const PARTS_ORDER_ENDPOINT = `${XANO_BASE}/record_parts_order`;

const PROCESSED_LABEL_NAME = 'PartsDelivery-Processed';
const MAX_MESSAGES_PER_RUN = 25;

// Each fingerprint describes one source. `query` is the Gmail search
// filter (must include a delivered/arrival signal — we only want
// delivery emails, not shipped-out emails). `extract` is a function
// (subject, snippet, headers) → observation object. Returning null
// means "this message isn't an actionable delivery — skip + label."
const FINGERPRINTS = [
  // Marcone — order confirmation includes order number; shipping
  // confirmation includes tracking; delivery notification confirms drop-off.
  {
    name: 'marcone_delivered',
    vendor: 'Marcone',
    query: 'from:(marcone.com OR marconeservice.com) (subject:delivered OR subject:"has been delivered" OR "your order was delivered")',
    extract: (subj, snip) => ({
      vendor: 'Marcone',
      order_number: matchFirst(subj + ' ' + snip, /order[\s#:]*(\w{6,16})/i),
      tracking_number: matchFirst(snip, /1Z[A-Z0-9]{16}|\b\d{12,22}\b/i),
    }),
  },
  // Tribles Appliance Parts — similar pattern.
  {
    name: 'triples_delivered',
    vendor: 'Tribles Appliance Parts',
    query: 'from:(triplesstore.com OR triples.com) (subject:delivered OR "has been delivered")',
    extract: (subj, snip) => ({
      vendor: 'Tribles Appliance Parts',
      order_number: matchFirst(subj + ' ' + snip, /order[\s#:]*(\w{6,16})/i),
      tracking_number: matchFirst(snip, /1Z[A-Z0-9]{16}|\b\d{12,22}\b/i),
    }),
  },
  // Reliable Parts.
  {
    name: 'reliable_delivered',
    vendor: 'Reliable Parts',
    query: 'from:(reliableparts.com OR reliableparts.net) (subject:delivered OR "has been delivered")',
    extract: (subj, snip) => ({
      vendor: 'Reliable Parts',
      order_number: matchFirst(subj + ' ' + snip, /order[\s#:]*(\w{6,16})/i),
      tracking_number: matchFirst(snip, /1Z[A-Z0-9]{16}|\b\d{12,22}\b/i),
    }),
  },
  // Amazon — ordered confirmation. Two-step capture: 'Your Amazon.com
  // order #XXX' on placement, and 'Your package has arrived' on delivery.
  // Different from Marcone/Tribles because Amazon doesn't have a single
  // canonical 'delivered' subject; matches on 'arrived' / 'has been
  // delivered' / 'was delivered'.
  {
    name: 'amazon_ordered',
    vendor: 'Amazon',
    query: 'from:(auto-confirm@amazon.com) subject:"Your Amazon.com order"',
    extract: (subj, snip) => ({
      vendor: 'Amazon',
      // Amazon order # format: '111-1234567-1234567' (17 chars including dashes)
      order_number: matchFirst(subj + ' ' + snip, /(\d{3}-\d{7}-\d{7})/),
    }),
  },
  {
    name: 'amazon_delivered',
    vendor: 'Amazon',
    query: 'from:(shipment-tracking@amazon.com OR auto-shipping@amazon.com) (subject:delivered OR "has been delivered" OR "package has arrived" OR "was delivered")',
    extract: (subj, snip) => ({
      vendor: 'Amazon',
      order_number: matchFirst(subj + ' ' + snip, /(\d{3}-\d{7}-\d{7})/),
      tracking_number: matchFirst(snip, /TBA\d{12,16}|1Z[A-Z0-9]{16}|\b\d{12,22}\b/i),
    }),
  },
  // FedEx delivery notification — generic shipping carrier, matches
  // anything we've shipped to the customer.
  {
    name: 'fedex_delivered',
    vendor: 'FedEx',
    query: 'from:trackingupdates@fedex.com (subject:delivered OR "has been delivered")',
    extract: (subj, snip) => ({
      vendor: 'FedEx',
      tracking_number: matchFirst(subj + ' ' + snip, /\b\d{12,22}\b/),
      // FedEx subjects sometimes include recipient zip — pull it as a hint.
      customer_zip_hint: matchFirst(snip, /\b(\d{5})\b/),
    }),
  },
  // UPS delivery notification.
  {
    name: 'ups_delivered',
    vendor: 'UPS',
    query: 'from:(mcinfo@ups.com OR pkginfo@ups.com OR ups.com) subject:delivered',
    extract: (subj, snip) => ({
      vendor: 'UPS',
      tracking_number: matchFirst(subj + ' ' + snip, /1Z[A-Z0-9]{16}/),
      customer_zip_hint: matchFirst(snip, /\b(\d{5})\b/),
    }),
  },
];

// ── Phase 2 Stage A: warranty ORDER emails (Frontdoor / Numeric) ──
// These carry the dispatch/claim id, which we resolve to a job via
// find_job_by_claim_number, then record_parts_order so the job flips to
// awaiting_parts. DRY-RUN by default (PARTS_ORDER_POLLER_LIVE != "true"):
// matches are returned in the response for review but NOT written/labeled,
// so we validate the regex against real Gmail before flipping live.
const FIND_JOB_ENDPOINT = `${XANO_BASE}/find_job_by_claim_number`;
const MARK_ARRIVED_ENDPOINT = `${XANO_BASE}/mark_parts_arrived`;
const ORDER_PROCESSED_LABEL = 'PartsOrder-Processed';
const ARRIVED_PROCESSED_LABEL = 'PartsArrived-Processed';
const ORDER_LIVE = process.env.PARTS_ORDER_POLLER_LIVE === 'true';
const DISPATCH_RE = /dispatch\s*id[:\s#]*(\d{5,12})/i;
const DISPATCH_RE2 = /dispatch[:\s#]*(\d{5,12})/i;
const PART_HINT_RE = /part[#:\s]*([A-Z0-9][A-Z0-9\-]{3,})/i;

const ORDER_FINGERPRINTS = [
  {
    name: 'frontdoor_ordered',
    vendor: 'frontdoor',
    query: 'subject:("ordered for dispatch" OR "successfully ordered")',
    extract: (subj, snip) => ({
      dispatch_id: matchFirst(subj + ' ' + snip, DISPATCH_RE) || matchFirst(subj + ' ' + snip, DISPATCH_RE2),
      part_hint: matchFirst(snip, PART_HINT_RE),
    }),
  },
  {
    name: 'parts_order_update',
    vendor: 'warranty',
    query: 'subject:"Order Update" ("ordered for the dispatch" OR "have been ordered for the dispatch")',
    extract: (subj, snip) => ({
      dispatch_id: matchFirst(subj + ' ' + snip, DISPATCH_RE) || matchFirst(subj + ' ' + snip, DISPATCH_RE2),
      part_hint: matchFirst(snip, PART_HINT_RE),
    }),
  },
];

// ── Phase 2 Stage C: warranty DELIVERED emails (dispatch-id match) ──
// When a warranty part is delivered (these carry the same dispatch/claim id as
// the order email), resolve the job and call mark_parts_arrived so the job
// flips parts_status=arrived + scheduling_status=not_ready and pops back into
// the schedule queue — closing the order→ETA→arrived→reschedule loop for the
// ~99% warranty volume with a CONFIDENT dispatch match (not the fuzzy name/zip
// match the vendor delivered-side uses). Shares the ORDER_LIVE dry-run gate.
const DELIVERED_DISPATCH_FINGERPRINTS = [
  {
    name: 'frontdoor_delivered',
    vendor: 'frontdoor',
    query: 'from:(frontdoorhome.com OR ahs.com OR frontdoor.com) (subject:delivered OR "has been delivered" OR "part delivered" OR "shipment delivered")',
    extract: (subj, snip) => ({
      dispatch_id: matchFirst(subj + ' ' + snip, DISPATCH_RE) || matchFirst(subj + ' ' + snip, DISPATCH_RE2),
    }),
  },
  {
    name: 'numeric_delivered',
    vendor: 'warranty',
    query: 'subject:("delivered for the dispatch" OR "delivered for dispatch" OR "parts delivered")',
    extract: (subj, snip) => ({
      dispatch_id: matchFirst(subj + ' ' + snip, DISPATCH_RE) || matchFirst(subj + ' ' + snip, DISPATCH_RE2),
    }),
  },
];

exports.handler = async () => {
  const startedAt = Date.now();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return jsonResp(500, { ok: false, error: 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN required' });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  let processedLabelId;
  try {
    processedLabelId = await resolveOrCreateLabel(gmail, PROCESSED_LABEL_NAME);
  } catch (e) {
    return jsonResp(500, { ok: false, error: 'label resolve failed: ' + e.message });
  }

  const results = [];
  let observed = 0;
  let skipped = 0;
  let errors = 0;

  for (const fp of FINGERPRINTS) {
    const q = `${fp.query} -label:${PROCESSED_LABEL_NAME}`;
    let ids;
    try {
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: MAX_MESSAGES_PER_RUN });
      ids = (list.data.messages || []).map((m) => m.id);
    } catch (e) {
      errors += 1;
      results.push({ fp: fp.name, error: e.message });
      continue;
    }
    if (!ids.length) continue;

    for (const id of ids) {
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
        const subject = headerOf(msg.data, 'Subject') || '';
        const snippet = msg.data.snippet || '';
        const extracted = fp.extract(subject, snippet);
        if (!extracted) { skipped += 1; await labelMsg(gmail, id, processedLabelId); continue; }

        const obs = {
          source: `gmail_${fp.name}`,
          vendor: extracted.vendor || fp.vendor,
          tracking_number: extracted.tracking_number || '',
          order_number: extracted.order_number || '',
          customer_name_hint: extracted.customer_name_hint || '',
          customer_zip_hint: extracted.customer_zip_hint || '',
          part_number_hint: extracted.part_number_hint || '',
          model_number_hint: extracted.model_number_hint || '',
          raw_subject: subject.slice(0, 200),
          raw_snippet: snippet.slice(0, 400),
        };

        // Fire BOTH downstream paths in parallel:
        //  1. record_parts_delivery_observation — feeds the
        //     parts_delivery_observed agent which matches against
        //     open awaiting_parts queue (existing flow)
        //  2. record_parts_order — writes a parts_orders ledger row
        //     with order_status='delivered' (NEW for Phase 4 — feeds
        //     parts_cost_optimizer + financial automation Phase B)
        //
        // The ledger row goes in WITHOUT a job_id when we can't
        // confidently match. The parts_delivery_observed agent will
        // later UPDATE the row with job_id once it finds the match.
        const obsPromise = fetch(XANO_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obs),
        });
        const ledgerPayload = {
          job_id: 0,
          part_number: obs.part_number_hint || obs.order_number || '(unknown)',
          part_name: '',
          supplier: (obs.vendor || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
          cost_cents: 0,
          model_number: obs.model_number_hint || '',
          order_reference: obs.order_number || obs.tracking_number || '',
          order_status: 'delivered',
          source: `gmail_poller_${fp.name}`,
          notes: [
            obs.tracking_number ? `tracking: ${obs.tracking_number}` : '',
            obs.customer_name_hint ? `customer: ${obs.customer_name_hint}` : '',
            obs.customer_zip_hint ? `zip: ${obs.customer_zip_hint}` : '',
            `subject: ${(obs.raw_subject || '').slice(0, 100)}`,
          ].filter(Boolean).join(' · '),
        };
        const ledgerPromise = fetch(PARTS_ORDER_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ledgerPayload),
        }).catch(() => null);

        const [res, ledgerRes] = await Promise.all([obsPromise, ledgerPromise]);
        if (res.ok) {
          observed += 1;
          await labelMsg(gmail, id, processedLabelId);
        } else {
          errors += 1;
          results.push({ fp: fp.name, id, status: res.status, ledger_status: ledgerRes && ledgerRes.status });
        }
      } catch (e) {
        errors += 1;
        results.push({ fp: fp.name, id, error: e.message });
      }
    }
  }

  // ── Order-side: warranty dispatch-id "ordered" emails (Stage A) ──
  let orderProcessedLabelId = null;
  if (ORDER_LIVE) {
    try { orderProcessedLabelId = await resolveOrCreateLabel(gmail, ORDER_PROCESSED_LABEL); } catch (_) {}
  }
  const orderResults = [];
  let ordersFlagged = 0;
  for (const fp of ORDER_FINGERPRINTS) {
    const q = ORDER_LIVE ? `${fp.query} -label:${ORDER_PROCESSED_LABEL}` : fp.query;
    let ids;
    try {
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: MAX_MESSAGES_PER_RUN });
      ids = (list.data.messages || []).map((m) => m.id);
    } catch (e) { results.push({ fp: fp.name, error: e.message }); continue; }
    if (!ids.length) continue;

    for (const id of ids) {
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
        const subject = headerOf(msg.data, 'Subject') || '';
        const snippet = msg.data.snippet || '';
        const ex = fp.extract(subject, snippet);
        if (!ex.dispatch_id) { orderResults.push({ fp: fp.name, matched: false, reason: 'no_dispatch_id', subject: subject.slice(0, 100) }); continue; }

        let jobId = 0;
        try {
          const fr = await fetch(`${FIND_JOB_ENDPOINT}?claim_number=${encodeURIComponent(ex.dispatch_id)}`);
          const fd = await fr.json().catch(() => ({}));
          jobId = Number(fd.job_id || (fd.job && fd.job.id) || (Array.isArray(fd.jobs) && fd.jobs[0] && fd.jobs[0].job_id) || 0);
        } catch (_) {}

        const rec = { fp: fp.name, dispatch_id: ex.dispatch_id, part_hint: ex.part_hint || '', job_id: jobId, subject: subject.slice(0, 100) };
        if (!ORDER_LIVE) { orderResults.push({ ...rec, action: 'dry_run' }); continue; }
        if (!jobId) { orderResults.push({ ...rec, action: 'no_job_match' }); continue; }

        const r = await fetch(PARTS_ORDER_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: jobId,
            part_number: ex.part_hint || ('dispatch-' + ex.dispatch_id),
            supplier: fp.vendor,
            order_status: 'ordered',
            source: `gmail_poller_${fp.name}`,
            notes: `auto from warranty email · dispatch ${ex.dispatch_id} · ${subject.slice(0, 80)}`,
          }),
        });
        if (r.ok) {
          ordersFlagged += 1;
          orderResults.push({ ...rec, action: 'ordered_flagged' });
          if (orderProcessedLabelId) await labelMsg(gmail, id, orderProcessedLabelId);
        } else {
          orderResults.push({ ...rec, action: 'record_failed', status: r.status });
        }
      } catch (e) { orderResults.push({ fp: fp.name, id, error: e.message }); }
    }
  }

  // ── Delivered-side: warranty dispatch-id "delivered" → mark_parts_arrived ──
  let arrivedProcessedLabelId = null;
  if (ORDER_LIVE) {
    try { arrivedProcessedLabelId = await resolveOrCreateLabel(gmail, ARRIVED_PROCESSED_LABEL); } catch (_) {}
  }
  const arrivedResults = [];
  let arrivedFlagged = 0;
  for (const fp of DELIVERED_DISPATCH_FINGERPRINTS) {
    const q = ORDER_LIVE ? `${fp.query} -label:${ARRIVED_PROCESSED_LABEL}` : fp.query;
    let ids;
    try {
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: MAX_MESSAGES_PER_RUN });
      ids = (list.data.messages || []).map((m) => m.id);
    } catch (e) { arrivedResults.push({ fp: fp.name, error: e.message }); continue; }
    if (!ids.length) continue;

    for (const id of ids) {
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
        const subject = headerOf(msg.data, 'Subject') || '';
        const snippet = msg.data.snippet || '';
        const ex = fp.extract(subject, snippet);
        if (!ex.dispatch_id) { arrivedResults.push({ fp: fp.name, matched: false, reason: 'no_dispatch_id', subject: subject.slice(0, 100) }); continue; }

        let jobId = 0;
        try {
          const fr = await fetch(`${FIND_JOB_ENDPOINT}?claim_number=${encodeURIComponent(ex.dispatch_id)}`);
          const fd = await fr.json().catch(() => ({}));
          jobId = Number(fd.job_id || (fd.job && fd.job.id) || (Array.isArray(fd.jobs) && fd.jobs[0] && fd.jobs[0].job_id) || 0);
        } catch (_) {}

        const rec = { fp: fp.name, dispatch_id: ex.dispatch_id, job_id: jobId, subject: subject.slice(0, 100) };
        if (!ORDER_LIVE) { arrivedResults.push({ ...rec, action: 'dry_run' }); continue; }
        if (!jobId) { arrivedResults.push({ ...rec, action: 'no_job_match' }); continue; }

        const r = await fetch(MARK_ARRIVED_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: jobId,
            source: `gmail_poller_${fp.name}`,
            notes: `auto from warranty delivered email · dispatch ${ex.dispatch_id} · ${subject.slice(0, 80)}`,
          }),
        });
        if (r.ok) {
          arrivedFlagged += 1;
          arrivedResults.push({ ...rec, action: 'arrived_flagged' });
          if (arrivedProcessedLabelId) await labelMsg(gmail, id, arrivedProcessedLabelId);
        } else {
          arrivedResults.push({ ...rec, action: 'mark_failed', status: r.status });
        }
      } catch (e) { arrivedResults.push({ fp: fp.name, id, error: e.message }); }
    }
  }

  return jsonResp(200, {
    ok: true,
    elapsed_ms: Date.now() - startedAt,
    observed,
    skipped,
    errors,
    details: results.slice(0, 20),
    order_mode: ORDER_LIVE ? 'live' : 'dry_run',
    orders_flagged: ordersFlagged,
    order_results: orderResults.slice(0, 30),
    arrived_flagged: arrivedFlagged,
    arrived_results: arrivedResults.slice(0, 30),
  });
};

function matchFirst(str, re) {
  const m = String(str || '').match(re);
  return m ? (m[1] || m[0]) : '';
}

function headerOf(message, name) {
  const headers = (message.payload && message.payload.headers) || [];
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

async function resolveOrCreateLabel(gmail, name) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const found = (list.data.labels || []).find((l) => l.name === name);
  if (found) return found.id;
  const created = await gmail.users.labels.create({ userId: 'me', requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
  return created.data.id;
}

async function labelMsg(gmail, id, labelId) {
  try {
    await gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: [labelId] } });
  } catch (_) {}
}

function jsonResp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
