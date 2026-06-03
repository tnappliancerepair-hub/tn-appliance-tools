#!/usr/bin/env node
// vapi-push — read JSON files from vapi-config/ and push them to Vapi.
// PATCH if id present, POST if new (sets id back into the local file).
//
// Usage:
//   node scripts/vapi-push.js                              # push all changed
//   node scripts/vapi-push.js --only assistants/foo.json   # push one
//   node scripts/vapi-push.js --dry                        # show what would change
//
// Order matters: tools first (so assistants can reference them),
// then assistants, then phone numbers (so they can route to assistants),
// then squads.

const fs = require('fs');
const path = require('path');
const vapi = require('../vapi-config/_lib/vapi-client');

const ROOT = path.join(__dirname, '..', 'vapi-config');
const DRY = process.argv.includes('--dry');
const ONLY_IDX = process.argv.indexOf('--only');
const ONLY = ONLY_IDX > -1 ? process.argv[ONLY_IDX + 1] : null;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function listJsonFiles(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

// Strip server-managed read-only fields before PATCH so we don't fight
// Vapi's own bookkeeping (id, createdAt, updatedAt, orgId, isServerless, etc.)
const READONLY = new Set([
  'id', 'orgId', 'createdAt', 'updatedAt', 'isServerless',
  'firstMessageMode', // deprecated rename safety
]);

function stripReadonly(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (READONLY.has(k)) continue;
    out[k] = obj[k];
  }
  return out;
}

function resolvePromptFile(assistantObj) {
  // If model.messages[0].content === { $file: "prompts/foo.md" }, inline it
  const messages = assistantObj.model && assistantObj.model.messages;
  if (!Array.isArray(messages)) return assistantObj;
  for (const msg of messages) {
    if (msg && typeof msg.content === 'object' && msg.content.$file) {
      const promptPath = path.join(ROOT, msg.content.$file);
      if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt file not found: ${msg.content.$file}`);
      }
      msg.content = fs.readFileSync(promptPath, 'utf8').trim();
    }
  }
  return assistantObj;
}

async function pushOne(category, file) {
  const fullPath = path.join(ROOT, file);
  let obj = readJson(fullPath);
  const isAssistant = category === 'assistants';
  if (isAssistant) obj = resolvePromptFile(obj);

  const id = obj.id;
  const body = stripReadonly(obj);
  // Vapi tool PATCH rejects 'type' (immutable post-creation). Strip on PATCH only.
  if (category === 'tools' && id && body.type) delete body.type;
  const action = id ? 'PATCH' : 'POST';

  console.log(`  ${action} ${file}${id ? ` (id ${id.slice(0, 8)}…)` : ''}`);
  if (DRY) return { skipped: true };

  let result;
  if (category === 'tools') {
    result = id ? await vapi.updateTool(id, body) : await vapi.createTool(body);
  } else if (category === 'assistants') {
    result = id ? await vapi.updateAssistant(id, body) : await vapi.createAssistant(body);
  } else if (category === 'phone-numbers') {
    // Phone numbers can only be PATCHed; new numbers come from buying via Vapi
    if (!id) throw new Error(`Phone number ${file} has no id — must be created via Vapi dashboard first`);
    result = await vapi.updatePhoneNumber(id, body);
  } else if (category === 'squads') {
    result = id ? await vapi.updateSquad(id, body) : await vapi.createSquad(body);
  }

  // If POST, the result contains the new id — write it back to the local file
  if (!id && result && result.id) {
    obj.id = result.id;
    writeJson(fullPath, obj);
    console.log(`    saved new id ${result.id} → ${file}`);
  }

  return { ok: true, result };
}

(async () => {
  console.log(`Vapi push ${DRY ? '(DRY RUN)' : ''} → ${ROOT}`);

  // Order: tools, assistants, phone-numbers, squads
  const order = ['tools', 'assistants', 'phone-numbers', 'squads'];
  const errors = [];

  for (const category of order) {
    const files = listJsonFiles(category);
    if (ONLY && !ONLY.startsWith(category)) continue;
    const targets = ONLY ? files.filter((f) => f === ONLY) : files;
    if (targets.length === 0) continue;
    console.log(`\n=== ${category} (${targets.length}) ===`);
    for (const f of targets) {
      try {
        await pushOne(category, f);
      } catch (e) {
        console.error(`    FAIL: ${e.message}`);
        errors.push({ file: f, error: e.message });
      }
    }
  }

  console.log(`\nDone. ${errors.length} error(s).`);
  if (errors.length) {
    process.exit(1);
  }
})();
