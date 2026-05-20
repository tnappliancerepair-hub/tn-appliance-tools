#!/usr/bin/env node
// Regenerate netlify/functions/_lib/brain/onboarding-prompt.js from the
// .md source. Why a .js wrapper: esbuild (Netlify's bundler) ships JS
// imports natively, but .md files require included_files config which
// failed silently in our 2026-05-20 test. Wrapping the prompt in a JS
// module exports.module guarantees the bundler ships it.
//
// Run after editing onboarding-prompt.md:
//   node scripts/build-prompt.js
//
// Idempotent. Commit both files.

const fs = require('fs');
const path = require('path');

const MD = path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'brain', 'onboarding-prompt.md');
const JS = path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'brain', 'onboarding-prompt.js');

const md = fs.readFileSync(MD, 'utf8').trim();
const out =
  '// AUTO-GENERATED from onboarding-prompt.md by scripts/build-prompt.js\n' +
  '// Edit the .md file (human-readable source-of-truth), then run:\n' +
  '//   node scripts/build-prompt.js\n' +
  '// Commit both files together.\n' +
  'module.exports = ' + JSON.stringify(md) + ';\n';
fs.writeFileSync(JS, out);

console.log('wrote ' + out.length + ' chars to ' + path.basename(JS));
