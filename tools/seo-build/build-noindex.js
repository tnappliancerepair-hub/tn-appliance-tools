// build-noindex.js — keep INTERNAL ops/admin/test pages out of Google. These
// are dashboards, payroll/financials, customer-PII queues, the secrets vault,
// and test pages — none should ever appear in search (SEO crawl-budget + privacy).
// Adds <meta name="robots" content="noindex,follow"> (noindex the page, still
// follow its links). EXPLICIT allow-list only — never touches marketing/SEO
// pages (city/brand/appliance/symptom/repair pages stay fully indexable).
// Idempotent.
//
// Run:  node tools/seo-build/build-noindex.js
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');

// Anything starting with these is an internal tool — safe, no public page uses them.
const PREFIXES = ['office-', 'tech-'];

// Explicit internal ops/admin/test pages (exact filenames).
const EXACT = new Set([
  'dashboard', 'money', 'payroll', 'financial-dashboard', 'cash-pipeline',
  'agent-proposals', 'callbacks', 'recent-calls', 'call-performance',
  'parts-ledger', 'parts-orders', 'job-detail', 'job-lifecycle',
  'needs-scheduled', 'needs-scheduling', 'dupe-cleanup', 'cluster-ranks',
  'warranty-review', 'warranty-submission-dashboard', 'owner-activity',
  'operator-status', 'company-admin', 'admin-secrets', 'admin-refund',
  'dispatch-tv', 'customer-search', 'email-intake-status', 'hcp-parity',
  'readiness', 'schedule-lee', 'schedule-shadow', 'scheduler-efficiency',
  'sms-pulse', 'loop-control', 'health-check', 'voice-dispatch',
  'teddy-tdr-tool', 'trace-viewer', 'trust-dashboard', 'vacation-status',
  'view-job', 'capture-overlay-test', 'test-cleanup', 'test-harness',
  'test-recorder', 'theme-preview', 'alec', 'anna',
]);

const isInternal = (f) => {
  const base = f.replace(/\.html$/, '');
  return PREFIXES.some((p) => f.startsWith(p)) || EXACT.has(base);
};

const files = fs.readdirSync(REPO).filter((f) => f.endsWith('.html'));
const touched = [];
for (const f of files) {
  if (!isInternal(f)) continue;
  let html = fs.readFileSync(path.join(REPO, f), 'utf8');
  if (/name="robots"/i.test(html)) continue;       // already has a robots directive
  if (!/<\/title>/i.test(html) && !/<head>/i.test(html)) continue;
  const tag = '\n<meta name="robots" content="noindex,follow">';
  if (/<\/title>/i.test(html)) html = html.replace(/<\/title>/i, `</title>${tag}`);
  else html = html.replace(/<head>/i, `<head>${tag}`);
  fs.writeFileSync(path.join(REPO, f), html, 'utf8');
  touched.push(f);
}
console.log(`noindex added to ${touched.length} internal pages:`);
console.log(touched.sort().join(', '));
