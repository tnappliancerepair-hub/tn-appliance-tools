// NSA (National Service Alliance) dispatch parser — deterministic, no LLM.
//
// WHY THIS EXISTS. NSA is ~13% of TN's warranty book and until now it had no parser
// ANYWHERE: the legacy Xano side captures the raw email as a "draft" for a human to
// retype (that is the "Email captured — needs review" husk path), and the platform side
// fell through to the Claude fallback. An LLM is the right backstop for a vendor we have
// never seen; it is the wrong thing to stand between us and 13% of the book every day,
// because it also PRODUCES THE DEDUP KEY — and a key that is sometimes the Case# and
// sometimes the Dispatch# silently creates twins.
//
// The format does not need a model. Every NSA dispatch is a flat `Label: Value` block:
//
//   Dispatch Details: Dispatch#: HAP20260937871167 Case#: H4442339 ... Brand: Hisense
//   Model: HRB171N6BSE Product Type: Refrigerator ... Complaint: ... Program: ...
//   Customer Details: First Name: Donna Last Name: Greer Address1: 255 Sam Ridley
//   Parkway West Address2: Lot 17 City: Smyrna State: TN Zip: 37167 Home Phone: ...
//
// ⚠️ THE ONE TRAP: the mail is HTML, and by the time a parser sees it the tags are
// stripped, so the WHOLE BLOCK IS ONE LINE. A `Label:\s*(.*)$` regex swallows the rest of
// the email. Every value here therefore terminates at the NEXT KNOWN LABEL. That is also
// why LABELS below must stay complete — a label we forget is not a missing field, it is a
// field that runs on and eats its neighbours.
//
// (This is the opposite situation from the NSA weekly parts DIGEST, which is a POSITIONAL
// <td> table where stripping tags collapses empty cells and shifts every column — that one
// must be read from raw HTML. A LABELLED block like this one is safe to read stripped,
// because an empty field simply drops its label and next-label termination absorbs it.)
'use strict';

// Every label NSA emits, plus the section headers that follow Customer Details. Order is
// irrelevant (each is matched independently) but COMPLETENESS is load-bearing: this list
// is the terminator set for every value.
const LABELS = [
  'Dispatch Details', 'Dispatch#', 'Case#', 'IVR Phone Number', 'IVR Phone Pin',
  'Master Code', 'Date Scheduled', 'Time Preference', 'Route', 'Group',
  'Brand', 'Model', 'Product Type', 'Serial', 'Selling Dealer', 'Date of Purchase',
  'Complaint', 'Program', 'PARTS ORDERING',
  'Customer Details', 'First Name', 'Last Name', 'Address1', 'Address2',
  'City', 'State', 'Zip', 'Home Phone', 'Mobile Phone', 'Work Phone', 'Email',
  // trailing sections — a value must stop here even though they are not fields
  'Service Literature', 'Special Instructions', 'Appliance Special Instructions',
  'Parts Ordering', 'Additional Parts Needed', 'Sealed System Repair',
  'WARRANTY', 'PICTURES', 'Authorization', 'Labor Rate',
];

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\#]/g, '\\$&'); }
const TERM = new RegExp('\\s(?:' + LABELS.map(esc).join('|') + ')\\s*:', 'i');

// value for one label, terminated at the next known label (or end of block).
function field(body, label) {
  const m = new RegExp('(?:^|\\s)' + esc(label) + '\\s*:\\s*').exec(body || '');
  if (!m) return '';
  const rest = body.slice(m.index + m[0].length);
  const stop = TERM.exec(rest);
  return (stop ? rest.slice(0, stop.index) : rest).replace(/\s+/g, ' ').trim();
}

// NSA repeats the complaint verbatim on some dispatches ("X. X."). Collapse an exact
// doubling only — never a near-match, so a genuinely repeated phrase is left alone.
function undouble(s) {
  const t = String(s || '').trim();
  if (t.length < 80) return t;
  const half = t.slice(0, Math.floor(t.length / 2)).trim();
  if (half && t.slice(Math.floor(t.length / 2)).trim() === half) return half;
  const probe = t.slice(0, 48);
  const i = t.indexOf(probe, 1);
  if (i > 0 && t.slice(0, i).trim() === t.slice(i).trim()) return t.slice(0, i).trim();
  return t;
}

function phone10(s) {
  const d = String(s || '').replace(/\D/g, '');
  const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (t.length !== 10) return '';
  if (/^(\d)\1{9}$/.test(t)) return '';          // 0000000000 / 5555555555
  if (t[0] === '0' || t[0] === '1') return '';   // not a valid US area code
  return t;
}

function cleanEmail(s) {
  const e = String(s || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return '';
  if (/^no-?email@|^none@|^n\/?a@/.test(e)) return '';   // NSA's noemail@email.com filler
  return e;
}

// NSA mail that is NOT a new job. The tee's Gmail query already excludes these; this is
// the second line of defense so any other route (a forward, a future connector) can't
// mint a job from a status ping. Creating jobs from notification mail is exactly how the
// Xano side accumulated ~406 junk shells.
const NOT_A_DISPATCH = /(cancel+ed|cancellation|update request|update needed|reply requested|closed dispatch|request for updated|failed repair notice|payment|remittance|eft)/i;

function isNsa(email) {
  const hay = [email && email.from, email && email.subject, email && (email.text || email.html)].join(' ');
  return /nationalservicealliance|national service alliance|\bNSA Dispatch\b/i.test(hay);
}

// -> { is_job, email_type, job|null }
function parseNsaDispatch(email) {
  const subject = String((email && email.subject) || '');
  const body = String((email && (email.text || email.html)) || '').replace(/\s+/g, ' ');

  if (NOT_A_DISPATCH.test(subject)) return { is_job: false, email_type: 'status', job: null };

  // Numbers come from the body; the subject carries both as a backstop, which is what
  // makes the key survive a body we failed to read.
  const sub = /Dispatch#\s*([A-Z0-9-]+)\s+Case#\s*([A-Z0-9-]+)/i.exec(subject) || [];
  const dispatchNo = (field(body, 'Dispatch#') || sub[1] || '').trim();
  const caseNo = (field(body, 'Case#') || sub[2] || '').trim();
  if (!dispatchNo && !caseNo) return { is_job: false, email_type: 'unknown', job: null };

  const first = field(body, 'First Name');
  const last = field(body, 'Last Name');
  // A dispatch always carries a customer. No customer block = a notification, not a job.
  if (!first && !last) return { is_job: false, email_type: 'status', job: null };

  const applianceRaw = field(body, 'Product Type');
  const address = [field(body, 'Address1'), field(body, 'Address2')].filter(Boolean).join(' ').trim();

  // Date Scheduled arrives as "2026-09-11 -- CALL and CONFIRM before running".
  const sched = field(body, 'Date Scheduled').replace(/\s*--.*$/, '').trim();
  const pref = field(body, 'Time Preference');
  // Carry NSA's time preference VERBATIM rather than decoding it — "M"/"D" are NSA's
  // codes and guessing at one puts a window on the customer's card that nobody promised.
  const serviceWindow = sched ? (pref ? sched + ' (NSA time pref: ' + pref + ')' : sched) : '';

  return {
    is_job: true,
    email_type: 'dispatch',
    job: {
      warranty_company: 'NSA',
      // claim = Case#, dispatch_id = Dispatch#. This matches the convention the existing
      // board rows already use, so a tee-created job DEDUPES AGAINST the Xano-mirrored
      // copy instead of twinning it.
      claim_number: caseNo || dispatchNo,
      dispatch_id: dispatchNo || caseNo,
      first, last,
      phone: phone10(field(body, 'Mobile Phone')) || phone10(field(body, 'Home Phone')) || phone10(field(body, 'Work Phone')),
      email: cleanEmail(field(body, 'Email')),
      address,
      city: field(body, 'City'),
      state: field(body, 'State').toUpperCase().slice(0, 2),
      zip: (field(body, 'Zip').match(/\d{5}/) || [''])[0],
      brand: field(body, 'Brand'),
      appliance_raw: applianceRaw,
      model: field(body, 'Model'),
      serial: field(body, 'Serial'),
      problem: undouble(field(body, 'Complaint')),
      service_window: serviceWindow,
    },
  };
}

module.exports = { parseNsaDispatch, isNsa, _field: field, _undouble: undouble, _phone10: phone10 };
