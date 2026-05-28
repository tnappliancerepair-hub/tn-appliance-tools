// Per-job warranty requirement checklist.
//
// Given a job_id, this function:
//   1. Loads the job + customer + TDR + attachments from Xano
//   2. Determines the warranty company (job.warranty_company)
//   3. Loads the matching checklist from _data/warranty-requirements.json
//   4. Computes captured/pending status for each item by checking:
//      - Field items: is the corresponding TDR column filled?
//      - Photo items: does an attachment with matching subject exist?
//   5. Returns the merged checklist so the brain (and the verification
//      panel) know exactly what's still needed for THIS warranty company.
//
// The brain calls this at session start AND after each tech message
// (cheap — just a Xano fetch + a JSON file read).
//
// Architectural note: the requirements live in a JSON file (versioned
// in git, editable from any IDE) rather than a Xano table. Danielle's
// future feedback loop will write `warranty_correction_event` rows
// that a nightly agent reads to propose JSON updates via PR.

const fs = require('fs');
const path = require('path');

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const REQUIREMENTS_PATH = path.join(__dirname, '_data', 'warranty-requirements.json');

let _requirementsCache = null;
function loadRequirements() {
  if (_requirementsCache) return _requirementsCache;
  const raw = fs.readFileSync(REQUIREMENTS_PATH, 'utf8');
  _requirementsCache = JSON.parse(raw);
  return _requirementsCache;
}

// Normalize a warranty company name into one of our checklist keys.
function normalizeVendor(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  const map = {
    ahs: 'ahs',
    americanhomeshield: 'ahs',
    frontdoor: 'frontdoor',
    frontdoorhomewarranty: 'frontdoor',
    fronthome: 'frontdoor',
    servicepower: 'servicepower',
    sp: 'servicepower',
    allstate: 'allstate',
    allstatedealerservices: 'allstate',
    squaretrade: 'squaretrade',
    choicehomewarranty: 'choice_home_warranty',
    choice: 'choice_home_warranty',
  };
  return map[k] || null;
}

async function fetchJobContext(jobId) {
  const r = await fetch(XANO_INTAKE + '/get_job_for_dashboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: parseInt(jobId, 10) }),
  });
  if (!r.ok) throw new Error('job fetch failed: ' + r.status);
  return await r.json();
}

// Decide whether each checklist item is captured.
function computeStatus(items, tdr, attachments) {
  const filledFields = new Set();
  if (tdr) {
    for (const k of Object.keys(tdr)) {
      const v = tdr[k];
      if (v !== null && v !== undefined && String(v).trim() !== '' && String(v) !== '0') {
        filledFields.add(k);
      }
    }
  }
  const subjectsPresent = new Set();
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a && a.attachment_type) subjectsPresent.add(String(a.attachment_type).toLowerCase());
    }
  }
  return items.map((item) => {
    let captured = false;
    if (item.type === 'field' && item.field) {
      captured = filledFields.has(item.field);
    } else if ((item.type === 'photo' || item.type === 'video') && item.subject) {
      captured = subjectsPresent.has(String(item.subject).toLowerCase());
    }
    return { ...item, captured };
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'GET or POST only' };
  }
  let jobId = null;
  if (event.httpMethod === 'GET') {
    jobId = (event.queryStringParameters || {}).job_id;
  } else {
    try {
      const b = JSON.parse(event.body || '{}');
      jobId = b.job_id;
    } catch (_) {}
  }
  if (!jobId) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'job_id required' }),
    };
  }

  let ctx;
  try {
    ctx = await fetchJobContext(jobId);
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'job context fetch failed: ' + err.message }),
    };
  }

  const requirements = loadRequirements();
  const job = ctx.job || {};
  const rawVendor = job.warranty_company || ctx.customer?.warranty_company || null;
  const vendorKey = normalizeVendor(rawVendor) || 'default';
  const checklist = requirements[vendorKey] || requirements.default;

  // Pick the latest TDR (highest id, or last in array)
  const tdrs = Array.isArray(ctx.all_tdrs) ? ctx.all_tdrs : [];
  const latestTdr = tdrs.length ? tdrs[tdrs.length - 1] : null;

  const attachments = Array.isArray(ctx.attachments)
    ? ctx.attachments
    : Array.isArray(ctx.job_attachments)
    ? ctx.job_attachments
    : [];

  const items = computeStatus(checklist.items, latestTdr, attachments);

  const totalRequired = items.filter((i) => i.required).length;
  const capturedRequired = items.filter((i) => i.required && i.captured).length;
  const pendingRequired = items.filter((i) => i.required && !i.captured);

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify({
      success: true,
      job_id: parseInt(jobId, 10),
      warranty_company_raw: rawVendor,
      warranty_company_key: vendorKey,
      display_name: checklist.display_name,
      submission_model: checklist.submission_model || null,
      notes: checklist.notes || null,
      counts: {
        total_required: totalRequired,
        captured_required: capturedRequired,
        pending_required: pendingRequired.length,
        complete: pendingRequired.length === 0,
      },
      items,
      next_pending: pendingRequired[0] || null,
    }),
  };
};
