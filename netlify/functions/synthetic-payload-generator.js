// SYNTHETIC PAYLOAD GENERATOR
// Creates realistic AHS XML payloads and POSTs them to the live ahs_email_intake
// endpoint with a test_run_id so the resulting jobs can be cleanly cleaned up.
//
// Customer phones are fake (+15555550XXX) so the customer-SMS gate
// (CUSTOMER_FACING_ENABLED=false) drops them at send_sms.
// Service addresses + zips are real TN/LA cities/zips so cluster routing works.
// Claim numbers prefixed TEST-<run_id>-<seq> so even without test_run_id we can
// spot them.
//
// Request: POST /.netlify/functions/synthetic-payload-generator
//   body: { test_run_id, count (default 10), vendor ("ahs" default) }
//
// Response: { ok, test_run_id, count_attempted, count_created,
//   count_dedup_skipped, jobs:[{job_id, claim, city}], errors:[...] }

const XANO_INTAKE_BASE =
  process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Cities + zips that map to real service_zone clusters (verified from production data).
const TN_CITIES = [
  { city: 'Antioch', zip: '37013', state: 'TN' },
  { city: 'Murfreesboro', zip: '37130', state: 'TN' },
  { city: 'Murfreesboro', zip: '37128', state: 'TN' },
  { city: 'Nashville', zip: '37210', state: 'TN' },
  { city: 'Clarksville', zip: '37042', state: 'TN' },
  { city: 'Hermitage', zip: '37076', state: 'TN' },
  { city: 'Mt Juliet', zip: '37122', state: 'TN' },
  { city: 'Bellevue', zip: '37221', state: 'TN' },
];
const LA_CITIES = [
  { city: 'New Orleans', zip: '70126', state: 'LA' },
  { city: 'New Orleans', zip: '70131', state: 'LA' },
  { city: 'Metairie', zip: '70003', state: 'LA' },
  { city: 'Kenner', zip: '70065', state: 'LA' },
  { city: 'Hammond', zip: '70401', state: 'LA' },
  { city: 'Slidell', zip: '70458', state: 'LA' },
  { city: 'Mandeville', zip: '70471', state: 'LA' },
  { city: 'Baton Rouge', zip: '70806', state: 'LA' },
];
const ALL_CITIES = [...TN_CITIES, ...LA_CITIES];

const APPLIANCES = [
  { type: 'refrigerator', label: 'Refrigerator' },
  { type: 'washer', label: 'Washer' },
  { type: 'dryer', label: 'Dryer' },
  { type: 'dishwasher', label: 'Dishwasher' },
  { type: 'range', label: 'Range' },
  { type: 'oven', label: 'Oven' },
  { type: 'microwave', label: 'Microwave' },
];

const BRANDS = ['Whirlpool', 'LG', 'Samsung', 'GE', 'Frigidaire', 'Maytag', 'KitchenAid'];

const PROBLEMS = [
  'Not cooling',
  'Not heating',
  'Leaking water',
  'Won\'t start',
  'Making loud noise',
  'Won\'t drain',
  'Door won\'t latch',
  'Temperature too high',
  'Display shows error code',
  'Ice maker not working',
];

const FIRST_NAMES = [
  'Sarah','Mike','Lisa','David','Jennifer','Robert','Mary','James','Patricia','John',
];
const LAST_NAMES = [
  'Johnson','Williams','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas',
];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad4() { return String(Math.floor(Math.random() * 10000)).padStart(4, '0'); }
function pad3() { return String(Math.floor(Math.random() * 1000)).padStart(3, '0'); }

// Generate an AHS XML payload matching the format ahs_email_intake_POST.xs parses.
// The parser walks the XML by `|split:` markers, so we only need the attributes it
// reads: Vendor/Customer/ServiceLocation/Dispatch[Id, DispatchDateTime, dispatchTypeValueList,
// ServiceFeeAmount]. Other XML body is decorative.
function buildAhsXml({ claimNumber, customerFirst, customerLast, customerPhone, address, city, state, zip, applianceLabel, brand, problem, dispatchDate }) {
  const dispatchDateStr = dispatchDate.toISOString().split('T')[0] + 'T08:00:00';
  return `<?xml version="1.0" encoding="UTF-8"?>
<VendorDispatch xsi:noNamespaceSchemaLocation="Dispatch.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Vendor Id="822218" Name="TN APPLIANCE EXCHANGE LLC">
    <PhoneNumber Type="OFF" Number="6152802949"/>
  </Vendor>
  <DepartmentList>
    <Department Id="1" Name="Appliance">
      <Customer FirstName="${customerFirst}" LastName="${customerLast}">
        <Phone Type="HOME" Number="${customerPhone}"/>
      </Customer>
      <ServiceLocation StreetAddress="${address}" City="${city}" State="${state}" ZipPostCode="${zip}"/>
      <CallNotes>
        <Message>${problem}. ${applianceLabel} brand ${brand}.</Message>
      </CallNotes>
      <DispatchList>
        <Dispatch Id="${claimNumber}" DispatchDateTime="${dispatchDateStr}" dispatchTypeValueList="Service" ServiceFeeAmount="100.00" Status="OPEN"/>
      </DispatchList>
      <CoverageNotes>
        <Note>Standard warranty coverage applies.</Note>
      </CoverageNotes>
      <ProductRemarks>
        <Remark>${applianceLabel}, brand ${brand}. ${problem}.</Remark>
      </ProductRemarks>
    </Department>
  </DepartmentList>
</VendorDispatch>`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method not allowed' });
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { ok: false, error: 'invalid json body' });
  }

  const testRunId = (body.test_run_id || '').trim();
  const count = Math.min(Math.max(parseInt(body.count || '10', 10), 1), 100);
  const vendor = (body.vendor || 'ahs').trim().toLowerCase();
  // Optional region filter: 'TN', 'LA', or 'mixed' (default)
  const region = (body.region || 'mixed').trim().toUpperCase();
  // Default dispatch date: tomorrow
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (!testRunId) {
    return json(400, { ok: false, error: 'test_run_id is required (used for reset_run later)' });
  }
  if (vendor !== 'ahs') {
    return json(400, { ok: false, error: 'only vendor=ahs supported in v1' });
  }

  const cityPool =
    region === 'TN' ? TN_CITIES : region === 'LA' ? LA_CITIES : ALL_CITIES;

  const jobs = [];
  const errors = [];
  let dedupSkipped = 0;

  for (let i = 0; i < count; i++) {
    const seq = String(i + 1).padStart(3, '0');
    const claimNumber = `TEST-${testRunId}-${seq}-${pad4()}`;
    const customerFirst = rand(FIRST_NAMES);
    const customerLast = rand(LAST_NAMES);
    const customerPhone = `+15555550${pad3()}`;
    const location = rand(cityPool);
    const address = `${100 + Math.floor(Math.random() * 9899)} Main St`;
    const appliance = rand(APPLIANCES);
    const brand = rand(BRANDS);
    const problem = rand(PROBLEMS);

    const xml = buildAhsXml({
      claimNumber,
      customerFirst,
      customerLast,
      customerPhone,
      address,
      city: location.city,
      state: location.state,
      zip: location.zip,
      applianceLabel: appliance.label,
      brand,
      problem,
      dispatchDate: tomorrow,
    });

    const payload = {
      rawXml: xml,
      gmail_message_id: `synthetic_${testRunId}_${seq}_${Date.now()}`,
      gmail_thread_id: '',
      sender: 'noreply@msg.frontdoor.com',
      subject: `AHS Dispatch ${claimNumber}`,
      test_run_id: testRunId,
    };

    try {
      const r = await fetch(`${XANO_INTAKE_BASE}/ahs_email_intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const respText = await r.text();
      let respJson;
      try { respJson = JSON.parse(respText); } catch (_) { respJson = { raw: respText.slice(0, 200) }; }

      if (!r.ok) {
        errors.push({ seq, claim: claimNumber, status: r.status, body: respText.slice(0, 200) });
        continue;
      }

      if (respJson.duplicate) {
        dedupSkipped++;
        continue;
      }

      if (respJson.success && respJson.job_id) {
        jobs.push({
          seq,
          job_id: respJson.job_id,
          customer_id: respJson.customer_id,
          claim: claimNumber,
          city: location.city,
          zip: location.zip,
          appliance: appliance.type,
          brand,
        });
      } else {
        errors.push({ seq, claim: claimNumber, body: respText.slice(0, 200) });
      }
    } catch (e) {
      errors.push({ seq, claim: claimNumber, err: String(e.message || e) });
    }
  }

  return json(200, {
    ok: true,
    test_run_id: testRunId,
    count_attempted: count,
    count_created: jobs.length,
    count_dedup_skipped: dedupSkipped,
    count_errors: errors.length,
    region,
    vendor,
    jobs,
    errors: errors.slice(0, 10),
  });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
