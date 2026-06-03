#!/usr/bin/env node
// vapi-pull — bootstrap (or refresh) local Vapi config from the live
// Vapi workspace. Writes JSON files to vapi-config/. Existing local
// edits are preserved by default — re-run with --force to overwrite.
//
// Usage:
//   node scripts/vapi-pull.js              # pull all, skip files that exist
//   node scripts/vapi-pull.js --force      # overwrite local files

const fs = require('fs');
const path = require('path');
const vapi = require('../vapi-config/_lib/vapi-client');

const ROOT = path.join(__dirname, '..', 'vapi-config');
const FORCE = process.argv.includes('--force');

function slugify(name) {
  return String(name || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function writeJson(dir, filename, obj) {
  const full = path.join(ROOT, dir, filename);
  if (fs.existsSync(full) && !FORCE) {
    console.log(`  skip ${dir}/${filename} (exists; use --force to overwrite)`);
    return;
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
  console.log(`  wrote ${dir}/${filename}`);
}

async function pullAssistants() {
  console.log('\n=== Assistants ===');
  const list = await vapi.listAssistants();
  const items = Array.isArray(list) ? list : (list.results || list.assistants || []);
  console.log(`  found ${items.length}`);
  for (const a of items) {
    const slug = slugify(a.name);
    const filename = `${slug}.json`;
    writeJson('assistants', filename, a);
  }
}

async function pullPhoneNumbers() {
  console.log('\n=== Phone Numbers ===');
  const list = await vapi.listPhoneNumbers();
  const items = Array.isArray(list) ? list : (list.results || list.phoneNumbers || []);
  console.log(`  found ${items.length}`);
  for (const p of items) {
    const slug = p.number ? p.number.replace(/[^0-9]/g, '') : slugify(p.name);
    const filename = `${slug}.json`;
    writeJson('phone-numbers', filename, p);
  }
}

async function pullTools() {
  console.log('\n=== Tools ===');
  const list = await vapi.listTools();
  const items = Array.isArray(list) ? list : (list.results || list.tools || []);
  console.log(`  found ${items.length}`);
  for (const t of items) {
    const name = t.function && t.function.name ? t.function.name : (t.name || `tool_${t.id.slice(0, 8)}`);
    const slug = slugify(name);
    writeJson('tools', `${slug}.json`, t);
  }
}

async function pullSquads() {
  console.log('\n=== Squads ===');
  try {
    const list = await vapi.listSquads();
    const items = Array.isArray(list) ? list : (list.results || list.squads || []);
    console.log(`  found ${items.length}`);
    for (const s of items) {
      writeJson('squads', `${slugify(s.name)}.json`, s);
    }
  } catch (e) {
    console.log(`  (no squads or endpoint unavailable: ${e.message.slice(0, 80)})`);
  }
}

(async () => {
  console.log(`Vapi pull → ${ROOT}`);
  console.log(`Mode: ${FORCE ? 'OVERWRITE' : 'preserve existing'}`);

  try {
    await pullAssistants();
    await pullPhoneNumbers();
    await pullTools();
    await pullSquads();
    console.log('\nDone.');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();
