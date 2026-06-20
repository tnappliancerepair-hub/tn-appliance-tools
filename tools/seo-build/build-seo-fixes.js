// build-seo-fixes.js — two safe, high-impact technical-SEO fixes:
//   1. Shorten over-long titles to <=60 chars so Google stops truncating them.
//      Keeps the keyword (the part before " | ") intact — that's the exact
//      search query — and appends the longest brand suffix that still fits.
//   2. Add a self-referencing canonical to any page missing one.
// Idempotent: re-running only changes pages that still need it.
//
// Run:  node tools/seo-build/build-seo-fixes.js
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SITE = 'https://tnapplianceexchange.net';
const MAX = 60;
const SUFFIXES = [' | TN Appliance Exchange', ' · TN Appliance']; // longest first

function bestTitle(core) {
  core = core.trim().replace(/\s+/g, ' ');
  for (const s of SUFFIXES) if ((core + s).length <= MAX) return core + s;
  return core; // keyword alone (already as short as we can go)
}

const files = fs.readdirSync(REPO).filter((f) => f.endsWith('.html'));
let titleFixed = 0, canonAdded = 0;

for (const f of files) {
  const fp = path.join(REPO, f);
  let html = fs.readFileSync(fp, 'utf8');
  let dirty = false;

  // 1) Title length
  const tm = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (tm) {
    const cur = tm[1].trim();
    if (cur.length > MAX && cur.includes(' | ')) {
      const core = cur.split(/\s*\|\s*/)[0];
      const next = bestTitle(core);
      if (next && next !== cur && next.length < cur.length) {
        html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${next}</title>`);
        dirty = true; titleFixed++;
      }
    }
  }

  // 2) Canonical
  if (!/rel="canonical"/i.test(html) && /<\/title>/i.test(html)) {
    const url = f === 'index.html' ? `${SITE}/` : `${SITE}/${f}`;
    html = html.replace(/<\/title>/i, `</title>\n<link rel="canonical" href="${url}">`);
    dirty = true; canonAdded++;
  }

  if (dirty) fs.writeFileSync(fp, html, 'utf8');
}
console.log(`Titles shortened to <=${MAX} chars: ${titleFixed}`);
console.log(`Canonical tags added: ${canonAdded}`);
