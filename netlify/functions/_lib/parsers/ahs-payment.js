// AHS / Frontdoor payment remittance parser.
//
// Exact AHS payment email format is NOT yet locked. Parser is defensive:
// it tries multiple anchor patterns and returns format_confidence so
// the intake endpoint can route low-confidence parses to manual review.
//
// Expected anchors (best guess from AHS dispatch email patterns +
// industry-standard remittance shape):
//   - Vendor number near "Vendor ID" or "Account #"
//   - EFT reference near "EFT" / "Trace" / "Advice"
//   - Per-claim lines: Invoice# / Dispatch ID, Customer, Address,
//     Gross, Net
//
// Returns the same shape as servicepower-payment.js for parser-symmetry.
// First real AHS payment fixture will let us tighten the line regex.

'use strict';

function parseAhsPayment(body) {
  if (!body || typeof body !== 'string') {
    return { format_confidence: 0, header: {}, lines: [], raw_text: '' };
  }

  const allLines = body.split(/\r?\n/);
  const header = {
    vendor_number: '',
    eft_reference: '',
    advice_number: '',
    period_ending: null,
    total_amount: 0,
  };
  const lines = [];
  let signals = 0;

  // ── Pass 1: header anchors ────────────────────────────────────────
  for (const raw of allLines) {
    const t = raw.trim();

    // AHS vendor IDs look like "1-822418" (or similar dash-prefixed).
    const vendorMatch = t.match(/(?:Vendor(?:\s+ID|\s+#|\s+Number)?|Account\s*#?)[\s:]+([\d\-]{6,})/i);
    if (vendorMatch && !header.vendor_number) {
      header.vendor_number = vendorMatch[1];
      signals++;
      continue;
    }

    // Standalone vendor pattern (e.g. "1-822418" alone on a line).
    if (!header.vendor_number) {
      const standaloneVendor = t.match(/^(\d-\d{6,7})$/);
      if (standaloneVendor) {
        header.vendor_number = standaloneVendor[1];
        signals++;
        continue;
      }
    }

    // EFT / Trace / Advice anchor.
    const eftMatch = t.match(/(?:EFT|Trace|Advice)(?:\s*(?:#|Number|Ref))?[\s:]+([\w\d\-]+)/i);
    if (eftMatch && !header.eft_reference) {
      header.eft_reference = eftMatch[1];
      signals++;
      continue;
    }

    // Total amount anchor.
    const totalMatch = t.match(/(?:Total|Payment\s+Amount|Net\s+Amount)[\s:]+\$?([\d,]+\.\d{2})/i);
    if (totalMatch && !header.total_amount) {
      header.total_amount = parseMoney(totalMatch[1]);
      signals += 2;
      continue;
    }

    // Period ending anchor.
    const periodMatch = t.match(/(?:Period|Statement|Pay\s+Period)\s+(?:Ending|End):\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (periodMatch) {
      header.period_ending = normalizeDate(periodMatch[1]);
      signals++;
      continue;
    }
  }

  // ── Pass 2: per-claim lines ───────────────────────────────────────
  // Best-effort: any line with a dispatch-ID-shaped token + two money
  // amounts (gross/net) gets captured. Customer name and address are
  // optional. Format unknown, so multiple regex attempts.

  // Pattern A: <dispatch_id> <customer> ... <gross> <net>
  const patternA = /^\s*([A-Z0-9\-]{8,20})\s+([A-Z][A-Z'\-\s,]{2,40})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/;
  // Pattern B: <invoice> <dispatch_id> <gross> <net> (no customer column)
  const patternB = /^\s*(\d{6,12})\s+([A-Z0-9\-]{8,20})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/;

  for (const raw of allLines) {
    let m = raw.match(patternA);
    if (m) {
      const [, dispatchId, name, gross, net] = m;
      lines.push({
        dispatch_id: dispatchId,
        customer_name: name.trim().replace(/\s+/g, ' '),
        gross_amount: parseMoney(gross),
        net_amount: parseMoney(net),
        total_amount: parseMoney(net),
        labor_amount: 0,
        parts_amount: 0,
        raw_line: raw.trim(),
      });
      signals++;
      continue;
    }
    m = raw.match(patternB);
    if (m) {
      const [, invoice, dispatchId, gross, net] = m;
      lines.push({
        invoice_number: invoice,
        dispatch_id: dispatchId,
        gross_amount: parseMoney(gross),
        net_amount: parseMoney(net),
        total_amount: parseMoney(net),
        labor_amount: 0,
        parts_amount: 0,
        raw_line: raw.trim(),
      });
      signals++;
    }
  }

  let confidence = Math.min(1, signals * 0.05);
  if (header.vendor_number && header.total_amount > 0 && lines.length > 0) {
    confidence = Math.max(confidence, 0.6);
  }
  if (header.vendor_number && header.eft_reference && lines.length > 1) {
    confidence = Math.max(confidence, 0.8);
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
  return parseFloat(String(s).replace(/[\$,]/g, '')) || 0;
}

function normalizeDate(s) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  mm = mm.padStart(2, '0');
  dd = dd.padStart(2, '0');
  yy = yy.length === 2 ? '20' + yy : yy;
  return `${yy}-${mm}-${dd}T00:00:00Z`;
}

function classifyAhsSubject(subject) {
  if (!subject) return 'unknown';
  const s = subject.toLowerCase();
  if (/payment|remittance|advice|settlement|eft/.test(s)) return 'payment';
  if (/dispatch|new dispatch|work order/.test(s)) return 'dispatch';
  return 'unknown';
}

module.exports = { parseAhsPayment, classifyAhsSubject };
