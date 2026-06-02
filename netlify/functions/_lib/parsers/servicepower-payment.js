// ServicePower (SquareTrade) payment remittance parser.
//
// Input: plaintext email body (the text/plain MIME part).
// Output: { format_confidence, header, lines[], raw_text }
//
// Body shape (verified 2026-05-15 from sample):
//
//   TNA00001
//   TN APPLIANCE EXCHANGE LLC    EFT    1156240224 ***3,015.00
//   Period Ending: 5/12/26
//   <claim_lines...>
//   055859874135   MILLER      LHFS28XBS       150.00       .00       .00    150.00
//
// Strategy: line-by-line. Header detected by keyword anchors
// ("EFT", "Period Ending"). Vendor number = standalone line matching
// /^TNA\d{5,6}$/. Claim lines = lines starting with 10-12 digit ID
// followed by run-length-tolerant whitespace columns.
//
// Returns format_confidence ∈ [0, 1]. < 0.5 = poller should still POST
// but flag for review. >= 0.5 = high-confidence parse.

'use strict';

function parseServicePowerPayment(body) {
  if (!body || typeof body !== 'string') {
    return { format_confidence: 0, header: {}, lines: [], raw_text: '' };
  }

  const allLines = body.split(/\r?\n/).map((l) => l.replace(/ /g, ' '));
  const header = {
    vendor_number: '',
    eft_reference: '',
    period_ending: null,
    total_amount: 0,
  };
  const lines = [];
  let signals = 0;

  // ── Pass 1: header anchors ────────────────────────────────────────
  for (const ln of allLines) {
    const t = ln.trim();

    // TNA##### standalone line.
    const vendorMatch = t.match(/^(TNA\d{4,6})$/);
    if (vendorMatch && !header.vendor_number) {
      header.vendor_number = vendorMatch[1];
      signals++;
      continue;
    }

    // "...EFT  <reference>  ***<total>"
    const eftMatch = t.match(/EFT\s+(\d{6,})\s+\*+\s*([\d,]+\.\d{2})/i);
    if (eftMatch && !header.eft_reference) {
      header.eft_reference = eftMatch[1];
      header.total_amount = parseFloat(eftMatch[2].replace(/,/g, ''));
      signals += 2;
      continue;
    }

    // "Period Ending: M/D/YY" or "Period Ending: M/D/YYYY"
    const periodMatch = t.match(/Period\s+Ending:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (periodMatch) {
      header.period_ending = normalizeDate(periodMatch[1]);
      signals++;
      continue;
    }
  }

  // ── Pass 2: claim lines ───────────────────────────────────────────
  // Anchor: line starts with 10+ digits (claim/invoice number), then
  // alpha customer name, optional model, then $ amounts. Tolerate
  // variable column widths.
  const lineRegex =
    /^\s*(\d{10,14})\s+([A-Z][A-Z'\-\s]{1,30}?)\s+([A-Z0-9\-]+)?\s+(\$?[\d,]+\.\d{2}|\.\d{2})\s+(\$?[\d,]+\.\d{2}|\.\d{2})\s+(\$?[\d,]+\.\d{2}|\.\d{2})\s+(\$?[\d,]+\.\d{2}|\.\d{2})\s*$/;

  for (const raw of allLines) {
    const m = raw.match(lineRegex);
    if (!m) continue;
    const [, claim, name, model, labor, parts, other, total] = m;
    lines.push({
      claim_number: claim,
      customer_name: name.trim().replace(/\s+/g, ' '),
      model_number: model ? model.trim() : null,
      labor_amount: parseMoney(labor),
      parts_amount: parseMoney(parts),
      other_amount: parseMoney(other),
      total_amount: parseMoney(total),
      net_amount: parseMoney(total),
      gross_amount: parseMoney(total),
      raw_line: raw.trim(),
    });
    signals++;
  }

  // Confidence: each header signal worth 0.2, each line worth 0.05,
  // capped at 1.0. Minimum 0.6 if vendor + total + at least 1 line
  // all parsed.
  let confidence = Math.min(1, signals * 0.05);
  if (header.vendor_number && header.total_amount > 0 && lines.length > 0) {
    confidence = Math.max(confidence, 0.7);
  }
  if (header.vendor_number && header.eft_reference && header.period_ending && lines.length > 1) {
    confidence = Math.max(confidence, 0.9);
  }

  return {
    format_confidence: confidence,
    header,
    lines,
    raw_text: body,
  };
}

function parseMoney(s) {
  if (s == null) return 0;
  const cleaned = String(s).replace(/[\$,]/g, '');
  return parseFloat(cleaned) || 0;
}

// "5/12/26" → "2026-05-12T00:00:00Z"; "5/12/2026" → same.
function normalizeDate(s) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  mm = mm.padStart(2, '0');
  dd = dd.padStart(2, '0');
  yy = yy.length === 2 ? '20' + yy : yy;
  return `${yy}-${mm}-${dd}T00:00:00Z`;
}

// Classify subject — caller (poller) uses this to decide whether to
// route to dispatch flow or payment flow.
function classifyServicePowerSubject(subject) {
  if (!subject) return 'unknown';
  const s = subject.toLowerCase();

  // 2026-06-02: order specific → general. Status updates first so
  // they don't get matched as dispatch.
  if (/estimate|status update|has been processed|not instantly approved|approval pending|reschedule notification|cancellation/.test(s)) {
    return 'status_update';
  }
  if (/payment|remittance|advice|settlement|eft|reimbursement/.test(s)) return 'payment';
  if (/new dispatch|new work order|service request|new offer|dispatch offer/.test(s)) return 'dispatch';
  // Generic dispatch/order-containing subjects → safer default
  if (/dispatch|work order/.test(s)) return 'status_update';
  return 'unknown';
}

module.exports = { parseServicePowerPayment, classifyServicePowerSubject };
