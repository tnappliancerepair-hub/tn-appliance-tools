#!/usr/bin/env node
// One-shot idempotent wiring: inserts the Ant App Shell script tag before the
// closing </body> on each operational page. Safe to re-run — skips pages that
// already have it. Run: node scripts/wire-ant-shell.js
const fs = require('fs');
const path = require('path');

const TAG = '<script src="/ant-shell.js?v=20260612-1" defer></script>';
const ROOT = path.resolve(__dirname, '..');

const PAGES = [
  // Office
  'office.html', 'office-dashboard.html', 'office-calendar.html',
  'needs-scheduled.html', 'needs-scheduling.html', 'customer-search.html',
  'warranty-review.html', 'financial-dashboard.html', 'office-today.html',
  'office-todo.html', 'office-pulse.html', 'office-kanban.html',
  'parts-ledger.html', 'job-detail.html', 'office-tn.html', 'office-la.html',
  // Tech
  'tech-daily-dashboard.html', 'tech-ant-chat.html', 'tech-simple.html',
  'tech-payouts.html', 'tech-performance.html', 'tech-day-off.html',
  'tech-leaderboard.html', 'tech-ant-live.html'
];

let wired = 0, skipped = 0, missing = 0;
for (const p of PAGES) {
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp)) { console.log('  MISSING  ' + p); missing++; continue; }
  let html = fs.readFileSync(fp, 'utf8');
  if (html.indexOf('ant-shell.js') !== -1) { console.log('  skip     ' + p); skipped++; continue; }
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) { console.log('  NO BODY  ' + p); missing++; continue; }
  html = html.slice(0, idx) + TAG + '\n' + html.slice(idx);
  fs.writeFileSync(fp, html);
  console.log('  WIRED    ' + p);
  wired++;
}
console.log('\n  ' + wired + ' wired, ' + skipped + ' already had it, ' + missing + ' missing/no-body');
