// shop-handle — turn a shop's business name into a short subdomain label.
// The platform domain is applianceant.com, so "appliance"/"repair"/etc. are already implied —
// the subdomain is just the shop's NAME. "Joey's Appliance Repair" -> "joeys" (joeys.applianceant.com).
// Keep it short: strip the generic trade/legal words, take the first 1–2 meaningful tokens.
'use strict';

// Generic words that add nothing to a subdomain (already implied by applianceant.com, or legal suffixes).
var STOP = new Set([
  'appliance', 'appliances', 'repair', 'repairs', 'service', 'services', 'svc',
  'llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'corporation', 'ltd',
  'the', 'and', 'of', 'a', 'an',
]);

function shopHandle(name) {
  var raw = String(name || '').toLowerCase();
  // possessives + punctuation -> spaces; collapse to tokens.
  var tokens = raw
    .replace(/['’]s\b/g, 's')                 // Joey's -> joeys
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  var meaningful = tokens.filter(function (t) { return !STOP.has(t); });
  if (!meaningful.length) meaningful = tokens;   // all-generic name — fall back to raw tokens
  // First 1–2 tokens keeps it short + recognizable ("music city", "mid tenn", "joeys").
  var handle = meaningful.slice(0, 2).join('-');
  handle = handle.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);
  return handle || 'shop';
}

module.exports = { shopHandle };
