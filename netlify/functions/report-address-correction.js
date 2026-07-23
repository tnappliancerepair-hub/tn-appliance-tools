// report-address-correction — promote a service-address correction that comes in on a
// PHONE CALL into the SAME one-tap board flag the SMS-reply path already raises. Before
// this, a caller who corrected their address on the phone had it captured only in the
// call summary / problem_summary notes (buried), so the tile kept showing the old address
// and a tech could roll to the wrong house (Daniel Reney #20600, 2026-07-23).
//
// It writes an `address_correction_reported` event (job_id + proposed address) — read by
// address-flags.js → office-board's red "📍 NEW ADDRESS FROM CUSTOMER — TAP TO APPLY"
// ribbon → Danielle eyeballs + saves. Per doctrine we FLAG for Danielle, never silently
// overwrite the service address.
//
//   POST { secret, job_id, proposed, city?, state?, zip?, source? }   ← explicit (Vapi tool / manual)
//   POST { secret, job_id, summary, source:'phone_scan' }             ← scan a call summary
//
// Explicit mode trusts the caller-supplied corrected address. Scan mode extracts a street
// address from the call summary and only flags when the house number DIFFERS from the job's
// current service address (so a read-back of the existing address never raises a false flag).
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const JOBS = crud.TABLES.jobs;
const EVENT_LOG = crud.TABLES.event_log;
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const s = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 200 : n).trim();
function houseNum(str) { const m = String(str || '').trim().match(/^\s*(\d{1,6})\b/); return m ? m[1] : ''; }

// Pull the first plausible US street address out of free text (call summary).
// number (2-6 digits) + name + a street-type suffix, optional ", City, ST ZIP".
const STREET_TYPES = 'Dr|Drive|St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Cir|Circle|Pl|Place|Ter|Terrace|Trl|Trail|Pkwy|Parkway|Hwy|Highway|Loop|Cove|Cv|Pike|Run|Bnd|Bend|Xing|Crossing|Pass|Sq|Square|Aly|Alley|Row|Walk|Path|Grn|Green|Manor|Mnr|Ridge|Rdg|Glen|Gln|Point|Pt|Landing|Lndg|Hollow|Holw';
function extractAddress(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const re = new RegExp('\\b(\\d{2,6}\\s+[A-Za-z0-9.\'#\\- ]{2,40}?\\s(?:' + STREET_TYPES + '))\\b\\.?(?:\\s*,?\\s*([A-Za-z .\'-]{2,30}?)\\s*,?\\s*\\b([A-Z]{2})\\b\\s*(\\d{5})(?:-\\d{4})?)?', 'i');
  const m = t.match(re);
  if (!m) return null;
  const street = m[1].replace(/[.,\s]+$/, '').trim();
  return { street, city: (m[2] || '').trim(), state: (m[3] || '').trim().toUpperCase(), zip: (m[4] || '').trim() };
}
function composeProposed(a) {
  if (!a) return '';
  const tail = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.street, tail].filter(Boolean).join(', ').slice(0, 200);
}

// Correction INTENT — the summary must actually be about changing the address, not just
// mentioning it. Keeps a read-back ("your address is 1880 Patricia Dr, correct?") from flagging.
function hasCorrectionIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!/address/.test(t)) return false;
  return /(correct|wrong|incorrect|update|updat|chang|new|different|actually|should be|is not|isn'?t|mistake|typo|move|moved)\b[^.]{0,50}address|address[^.]{0,50}(is wrong|incorrect|should be|is actually|is now|changed|different|not right|to \d)/.test(t)
    || /(provid|gave|gan?ve)\w*[^.]{0,25}\d{2,6}\s+\w/.test(t) && /address/.test(t);
}

async function alreadyFlagged(jobId, proposedHouse) {
  try {
    const rows = await crud.searchPage(EVENT_LOG, { action: 'address_correction_reported' }, { id: 'desc' }, 400);
    for (const r of rows || []) {
      let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      m = m || {};
      if (Number(m.job_id) === jobId && houseNum(m.proposed) === proposedHouse) return true;
    }
  } catch (_) {}
  return false;
}

async function textDanielle(jobId, proposed) {
  const to = process.env.DANIELLE_PHONE_NUMBER || '+16154850713';
  const message = `📍 New address from a phone call on job #${jobId}: ${proposed}. Open the board — the tile has a red "tap to apply" flag. (Ann won't change it herself.)`;
  try {
    await fetch(`${XANO_BASE}/send_sms`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, message: message.slice(0, 480), recipient_role: 'office', context: { source: 'phone_address_correction', job_id: jobId } }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'invalid_json' }); }
  if (s(b.secret, 80) !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const jobId = parseInt(b.job_id, 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });
  const source = s(b.source, 24) || 'phone';
  const notify = b.notify !== false && b.notify !== 'false';

  // Resolve the corrected address — either explicitly supplied or scanned from a summary.
  let proposed = '';
  let parsed = null;
  if (s(b.proposed)) {
    parsed = { street: s(b.proposed, 120), city: s(b.city, 40), state: s(b.state, 2).toUpperCase(), zip: s(b.zip, 10) };
    proposed = composeProposed(parsed) || s(b.proposed);
  } else if (s(b.summary, 4000)) {
    if (!hasCorrectionIntent(b.summary)) return json(200, { ok: true, flagged: false, reason: 'no_correction_intent' });
    parsed = extractAddress(b.summary);
    if (!parsed) return json(200, { ok: true, flagged: false, reason: 'no_address_found' });
    proposed = composeProposed(parsed);
  } else {
    return json(400, { ok: false, error: 'proposed or summary required' });
  }
  if (!proposed || houseNum(proposed) === '' || houseNum(proposed) === '1') {
    return json(200, { ok: true, flagged: false, reason: 'no_valid_street' });
  }

  // Compare against the job's current service address. In scan mode, only flag when the
  // house number genuinely differs (the strong signal it's a NEW address, not a read-back).
  let current = null;
  try { current = await crud.searchOne(JOBS, { id: jobId }); } catch (_) {}
  const curAddr = current ? [current.service_address, current.service_city, current.service_zip].filter(Boolean).join(', ') : '';
  const curHouse = houseNum(current && current.service_address);
  const newHouse = houseNum(proposed);
  const isScan = !s(b.proposed);
  if (isScan && curHouse && newHouse && curHouse === newHouse) {
    return json(200, { ok: true, flagged: false, reason: 'same_house_number', current: curAddr });
  }

  if (await alreadyFlagged(jobId, newHouse)) {
    return json(200, { ok: true, flagged: false, reason: 'already_flagged', proposed });
  }

  await crud.logEvent('address_correction_reported', {
    job_id: jobId, proposed: proposed.slice(0, 200), source,
    prior_address: curAddr || '', at_ms: Date.now(),
  });
  if (notify) await textDanielle(jobId, proposed);

  return json(200, { ok: true, flagged: true, job_id: jobId, proposed, prior_address: curAddr, source, notified: notify });
};
