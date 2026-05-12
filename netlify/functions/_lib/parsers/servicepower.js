// ServicePower email parser. Input: plaintext email body (the text/plain
// MIME part from a ServicePower email). Output: { email_type, dispatches[] }
// where each dispatch is a structured record ready to POST to Xano.
//
// Body shape (verified 2026-05-12 from real fixtures, see
// docs/servicepower-sample-offer-emails-2026-05-12.md):
//
//   Servicepower Email Communication
//   ServicePower
//   Service and Installation Request          <-- section header
//   Servicer Account TNA00001
//   Call # 098894074139
//   Source SQUARE TRADE
//   Brand General Electric
//   ...
//   Customer Problem:
//   <free text problem description>
//   Contact the consumer immediately...
//
// Each line of fields is `{key}{whitespace}{value}` where {key} is one
// of a closed set of known multi-word keys. Multiple "Service Request
// Offer" sections may appear in one email — each is a separate dispatch.
//
// Parser strategy: line-by-line state machine with section boundary
// recognition. Tracked carefully because the longest-prefix match on
// field keys is required (e.g. "Schedule Date" must match before "Schedule
// Period").

const { normalizePhone, parseName, parseDateMDY, buildDedupSignature } = require('../normalize');

// Section headers — appearance of any of these starts a new dispatch
// record. The "current dispatch" accumulator commits to dispatches[] when
// the next section starts (or at end-of-input).
const SECTION_HEADERS = [
  'Service and Installation Request',
  'Service Request Offer',
  'Service Request Notice Cancellation',
];

// Known field keys, sorted longest-first so prefix-matching finds the
// most specific match first ("Schedule Date" before "Schedule Period",
// "Consumer Address" before "Consumer", etc.).
const FIELD_KEYS = [
  'Servicer Account',
  'Call No',                  // cancellation variant
  'Call #',
  'Source',
  'Source-Manufacturer id',   // cancellation variant
  'Brand',
  'Product',
  'Model #',
  'Serial #',
  'Schedule Date',
  'Schedule Period',
  'Call Taken',
  'Call Type',
  'ServiceType',
  'Service on date',          // cancellation variant
  'Date of call',             // cancellation variant
  'Authority Number',
  'Co-Pay',
  'Contract #',
  'Install Date',
  'Repeat Call',
  'Call Status',
  'Call Sub Status',
  'Consumer Name',
  'Consumer First Name',      // cancellation variant
  'Consumer Last Name',       // cancellation variant
  'Consumer Address',
  'City',
  'State',
  'Zip Code',
  'Zip code',                 // cancellation variant (different case)
  'Home Phone',
  'Cell Phone',
  'Work Phone',
  'Consumer Phone No',        // cancellation variant
  'Consumer Email',
  'Network Attribute',
  'ClientCode',
  'Appointment completion form',
];
const FIELD_KEYS_SORTED = [...FIELD_KEYS].sort((a, b) => b.length - a.length);

const PROBLEM_HEADER = 'Customer Problem:';
const PROBLEM_TERMINATORS = [
  /^Contact the consumer/i,
  /^After Acceptance/i,
  /^The above product/i,
  /^The above Service/i,
  /^If you are unable/i,
  /^Do not reply/i,
  /^Notice:/i,
  /^To view all calls/i,
];

function isSectionHeader(line) {
  return SECTION_HEADERS.some((h) => line === h || line.startsWith(h));
}

function isProblemTerminator(line) {
  return PROBLEM_TERMINATORS.some((re) => re.test(line));
}

function findFieldKey(line) {
  for (const key of FIELD_KEYS_SORTED) {
    // Require trailing space-or-end so "Call #" doesn't match "Call No" by accident
    // (the longest-first sort already orders "Call No" before "Call #" since both
    // are 7+ chars, but explicit guard keeps semantics tight).
    if (line === key) return { key, value: '' };
    if (line.startsWith(key + ' ') || line.startsWith(key + '\t')) {
      return { key, value: line.substring(key.length).trim() };
    }
  }
  return null;
}

// Classify email_type from the subject line (preferred — most reliable)
// with section-header fallback. Returns one of the allowed email_type
// enum values from docs/servicepower-schema-delta-2026-05-12.md.
function classifyEmailType(subject, sectionHeader) {
  const s = (subject || '').toLowerCase();
  const h = (sectionHeader || '').toLowerCase();

  if (s.includes('rescheduled')) return 'SCHEDULE_CHANGE';
  if (s.includes('cancellation') || h.includes('cancellation')) return 'CANCELLATION';
  if (s.includes('new notes') || s.includes('servicer new notes')) return 'NOTES_ADDED';
  if (s.includes('status update') || s.includes('call status update')) return 'STATUS_UPDATE';
  if (s.includes('status report')) return 'DAILY_DIGEST';

  // The "Service Request Offer" section header means pre-accept (caller
  // needs to ACCEPT/REJECT). "Service and Installation Request" header
  // means post-accept confirmation.
  if (h.includes('service request offer')) return 'DISPATCH_OFFER';
  if (h.includes('service and installation request')) return 'DISPATCH_OFFER_ACCEPTED';

  // Subject-only fallback
  if (s === 'service request') return 'DISPATCH_OFFER_ACCEPTED';
  if (s === 'service request notice') return 'DISPATCH_OFFER';

  return 'UNKNOWN';
}

// Map a raw appliance description to the canonical lowercase enum used
// elsewhere in the codebase (mirrors the AHS parser's appliance map).
const APPLIANCE_MAP = [
  { match: /refrigerator|fridge/i, canonical: 'refrigerator' },
  { match: /washing machine|wg washing machine|\bwasher\b/i, canonical: 'washer' },
  { match: /\bdryer\b/i, canonical: 'dryer' },
  { match: /dishwasher/i, canonical: 'dishwasher' },
  { match: /\b(range|oven|stove|cooktop|home cooking)\b/i, canonical: 'range' },
  { match: /microwave/i, canonical: 'microwave' },
];

function canonicalizeAppliance(raw) {
  if (!raw) return '';
  for (const { match, canonical } of APPLIANCE_MAP) {
    if (match.test(raw)) return canonical;
  }
  return raw.toLowerCase();
}

// ─── MAIN PARSER ─────────────────────────────────────────────────────
// Returns { email_type, dispatches: [{ ... }] }.
// Multi-section emails return multiple dispatch entries.
// Single-section emails return one entry.
// Section-less emails (e.g. NEW NOTES — completely different body shape,
// uses "Call Number:" key with colon, no section header) return one stub
// dispatch with at least the call_number populated via fallback regex,
// so the Xano endpoint's logged-only/notes-append path still fires.
function parseServicePowerBody(body, subject) {
  if (!body) return { email_type: 'UNKNOWN', dispatches: [] };

  const lines = body.split(/\r?\n/);
  const dispatches = [];
  let current = null;
  let problemBuffer = [];
  let inProblem = false;
  let primarySectionHeader = '';

  const commit = () => {
    if (!current) return;
    if (problemBuffer.length) current._fields['Customer Problem'] = problemBuffer.join('\n').trim();
    dispatches.push(buildDispatchRecord(current));
    problemBuffer = [];
    inProblem = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Section boundary
    if (isSectionHeader(line)) {
      commit();
      current = { _section: line, _fields: {} };
      if (!primarySectionHeader) primarySectionHeader = line;
      continue;
    }

    // Free-text problem header
    if (line === PROBLEM_HEADER || line.startsWith('Customer Problem')) {
      // Could be "Customer Problem:" alone OR could include inline text.
      // For now treat as header — text follows on subsequent lines.
      if (current) inProblem = true;
      continue;
    }

    if (inProblem) {
      if (isProblemTerminator(line)) {
        inProblem = false;
        // Don't continue here — fall through to field-key matching for this line
      } else {
        problemBuffer.push(line);
        continue;
      }
    }

    // No active section yet — likely preamble. Skip.
    if (!current) continue;

    // Field-key longest-prefix match
    const matched = findFieldKey(line);
    if (matched) {
      current._fields[matched.key] = matched.value;
    }
    // Unmatched lines are silently ignored. They're typically blank or
    // boilerplate footer; the section terminator regex caught most of them.
  }
  commit();

  const email_type = classifyEmailType(subject, primarySectionHeader);

  // Fallback for section-less emails (NEW NOTES, STATUS_UPDATE, etc.):
  // if the walker produced no dispatches, emit a single stub dispatch
  // with at least call_number extracted via regex. This keeps the
  // downstream contract simple: every email yields >=1 dispatch.
  if (dispatches.length === 0) {
    const stub = buildStubDispatch(body);
    dispatches.push(stub);
  }

  return { email_type, dispatches };
}

// Build a minimal dispatch record for emails that don't match any known
// section header. Used for NEW NOTES, STATUS_UPDATE, etc. — anything
// where we just need to attach the email to the right parent job.
//
// Critical extraction: call_number via regex match against both "Call #"
// (dispatch-offer convention) and "Call Number:" (NEW NOTES convention).
function buildStubDispatch(body) {
  let callNumber = '';
  // Try "Call Number: <digits>" first (NEW NOTES shape)
  const m1 = body.match(/Call Number:\s*(\d+)/i);
  if (m1) {
    callNumber = m1[1];
  } else {
    // Fallback: "Call #\s+<digits>" (dispatch-offer convention)
    const m2 = body.match(/Call\s*#\s+(\d+)/i);
    if (m2) callNumber = m2[1];
  }
  return {
    section_header: '',
    call_number: callNumber,
    servicer_account: '',
    source: '',
    source_manufacturer_id: '',
    brand: '',
    product_raw: '',
    appliance_type: '',
    model: '',
    serial: '',
    schedule_date: null,
    schedule_period: '',
    call_taken_date: null,
    service_on_date: null,
    call_type: '',
    service_type: '',
    authority_number: '',
    co_pay: '',
    contract_number: '',
    install_date: null,
    repeat_call: false,
    call_status: '',
    call_sub_status: '',
    network_attribute: '',
    client_code: '',
    appointment_form_url: '',
    problem: '',
    customer: {
      raw_name: '',
      first_name: '',
      last_name: '',
      full_name: '',
      raw_phone: '',
      phone10: null,
      home_phone: '',
      cell_phone: '',
      work_phone: '',
      email: '',
      raw_street: '',
      raw_city: '',
      raw_state: '',
      raw_zip: '',
      // Stub dispatches have no customer data — dedup_status=FAILED.
      // The Xano endpoint's logged-only path doesn't act on dedup fields
      // for these (no new customer/job created), so values are
      // informational only.
      addr_norm: null,
      dedup_signature: null,
      dedup_status: 'FAILED',
    },
  };
}

// Convert the raw field map into the structured dispatch record expected
// by the Xano endpoint (per the architecture proposal contract).
function buildDispatchRecord(raw) {
  const f = raw._fields;

  // Pull customer name (Service Request / Service Request Notice path)
  // OR first/last separately (Cancellation path).
  let customerName = '';
  if (f['Consumer Name']) {
    customerName = f['Consumer Name'];
  } else if (f['Consumer First Name'] || f['Consumer Last Name']) {
    customerName = [f['Consumer First Name'], f['Consumer Last Name']].filter(Boolean).join(' ');
  }
  const { first_name, last_name, full_name } = parseName(customerName);

  // Pull phone — try Home / Cell / Work / Consumer Phone No in order
  const rawPhone = f['Home Phone'] || f['Cell Phone'] || f['Work Phone'] || f['Consumer Phone No'] || '';
  const phone10 = normalizePhone(rawPhone);

  // Call # / Call No (cancellation variant)
  const callNumber = (f['Call #'] || f['Call No'] || '').trim();

  // Schedule + Call Taken / Service on date / Date of call dates
  const scheduleDate = parseDateMDY(f['Schedule Date']);
  const callTakenDate = parseDateMDY(f['Call Taken'] || f['Date of call']);
  const serviceOnDate = parseDateMDY(f['Service on date']);
  const installDate = parseDateMDY(f['Install Date']);

  // Product canonicalization
  const productRaw = f['Product'] || '';
  const applianceType = canonicalizeAppliance(productRaw);

  // Repeat call: NO/YES/Y/N → bool
  const repeatCallRaw = (f['Repeat Call'] || '').trim().toLowerCase();
  const repeatCall = repeatCallRaw === 'yes' || repeatCallRaw === 'y' || repeatCallRaw === 'true';

  // Zip — accept both "Zip Code" and "Zip code"
  const zip = f['Zip Code'] || f['Zip code'] || '';
  const rawStreet = (f['Consumer Address'] || '').trim();
  const rawCity = (f['City'] || '').trim();
  const rawState = (f['State'] || '').trim();

  // Compute the full normalized dedup signature here so the Xano endpoint
  // doesn't have to do string manipulation (footgun #28 + general XS pain).
  // buildDedupSignature returns { signature, status, phone10, addrNorm }.
  // status is one of: OK | PARTIAL_PHONE_ONLY | PARTIAL_ADDR_ONLY | FAILED.
  const dedup = buildDedupSignature(rawPhone, rawStreet, rawCity, rawState, zip);

  return {
    // Section + raw section header
    section_header: raw._section || '',
    // Canonical fields
    call_number: callNumber,
    servicer_account: (f['Servicer Account'] || '').trim(),
    source: (f['Source'] || '').trim(),
    source_manufacturer_id: (f['Source-Manufacturer id'] || '').trim(),
    brand: (f['Brand'] || '').trim(),
    product_raw: productRaw,
    appliance_type: applianceType,
    model: (f['Model #'] || '').trim(),
    serial: (f['Serial #'] || '').trim(),
    schedule_date: scheduleDate,
    schedule_period: (f['Schedule Period'] || '').trim(),
    call_taken_date: callTakenDate,
    service_on_date: serviceOnDate,
    call_type: (f['Call Type'] || '').trim(),
    service_type: (f['ServiceType'] || '').trim(),
    authority_number: (f['Authority Number'] || '').trim(),
    co_pay: (f['Co-Pay'] || '').trim(),
    contract_number: (f['Contract #'] || '').trim(),
    install_date: installDate,
    repeat_call: repeatCall,
    call_status: (f['Call Status'] || '').trim(),
    call_sub_status: (f['Call Sub Status'] || '').trim(),
    network_attribute: (f['Network Attribute'] || '').trim(),
    client_code: (f['ClientCode'] || '').trim(),
    appointment_form_url: (f['Appointment completion form'] || '').trim(),
    problem: (f['Customer Problem'] || '').trim(),
    customer: {
      raw_name: customerName,
      first_name,
      last_name,
      full_name,
      raw_phone: rawPhone,
      phone10: dedup.phone10,
      home_phone: (f['Home Phone'] || '').trim(),
      cell_phone: (f['Cell Phone'] || '').trim(),
      work_phone: (f['Work Phone'] || '').trim(),
      email: (f['Consumer Email'] || '').trim(),
      raw_street: rawStreet,
      raw_city: rawCity,
      raw_state: rawState,
      raw_zip: zip,
      // Pre-computed dedup fields — Xano endpoint uses these directly,
      // no normalization logic in XanoScript (per Phase A1 amendment).
      addr_norm: dedup.addrNorm,
      dedup_signature: dedup.signature,
      dedup_status: dedup.status,
    },
  };
}

module.exports = {
  parseServicePowerBody,
  classifyEmailType,
  // Exposed for tests
  isSectionHeader,
  findFieldKey,
  canonicalizeAppliance,
  SECTION_HEADERS,
  FIELD_KEYS,
};
