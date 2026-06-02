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

        const res = await fetch(XANO_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obs),
        });
        if (res.ok) {
          observed += 1;
          await labelMsg(gmail, id, processedLabelId);
        } else {
          errors += 1;
          results.push({ fp: fp.name, id, status: res.status });
        }
      } catch (e) {
        errors += 1;
        results.push({ fp: fp.name, id, error: e.message });
      }
    }
  }

  return jsonResp(200, {
    ok: true,
    elapsed_ms: Date.now() - startedAt,
    observed,
    skipped,
    errors,
    details: results.slice(0, 20),
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
