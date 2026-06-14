#!/usr/bin/env node
// vapi-wire-inbound — automate Ant Inbound's tool wiring so we never click
// through the Vapi dashboard again.
//
// What it does (idempotent, re-runnable):
//   1. Ensures our tools exist in Vapi (create if missing, update if present),
//      reading the canonical JSON from vapi-config/tools/.
//   2. Finds the live "Ant Inbound" assistant.
//   3. Sets assistant.model.toolIds to EXACTLY our set — which attaches ours
//      AND detaches the developers'/QA tools in one shot. Built-in tools
//      (transferCall/endCall in model.tools) are left untouched.
//
// Safe by default: prints the plan and the before/after tool list. Pass
// --apply to actually write.
//
// Usage:
//   node scripts/vapi-wire-inbound.js            # dry run (show plan)
//   node scripts/vapi-wire-inbound.js --apply    # do it

const fs = require('fs');
const path = require('path');
const vapi = require('../vapi-config/_lib/vapi-client');

const ROOT = path.join(__dirname, '..', 'vapi-config');
const APPLY = process.argv.includes('--apply');

// The tools Ant Inbound should have — all OURS (point at our Xano / Netlify).
const DESIRED_TOOL_FILES = [
  'lookup_customer_by_phone.json',
  'lookup_by_claim_number.json',
  'search_customers.json',
  'capture_callback.json',
  'voice_followup_send_links.json',
];
const INBOUND_NAME = 'Ant Inbound';

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function toolName(t) { return (t && t.function && t.function.name) || t.name || '(unnamed)'; }

async function ensureTool(file) {
  const fullPath = path.join(ROOT, 'tools', file);
  if (!fs.existsSync(fullPath)) throw new Error(`missing tool file: tools/${file}`);
  const local = readJson(fullPath);
  const name = toolName(local);
  const url = (local.server && local.server.url) || '';
  if (!/api:3e_TffpA|tnapplianceexchange\.net\/\.netlify/.test(url)) {
    console.log(`  ⚠ ${name}: server url is not ours (${url}) — skipping for safety`);
    return null;
  }

  const existing = (await vapi.listTools());
  const list = Array.isArray(existing) ? existing : (existing.results || existing.tools || []);
  const match = list.find((t) => toolName(t) === name);

  // Build the create/update body (no read-only fields).
  const body = { type: local.type, function: local.function, server: local.server };
  if (local.messages) body.messages = local.messages;

  if (match) {
    if (APPLY) {
      const upd = { function: body.function, server: body.server };
      if (body.messages) upd.messages = body.messages;
      await vapi.updateTool(match.id, upd); // type is immutable on PATCH
    }
    console.log(`  ${APPLY ? 'updated' : 'would update'} ${name} (id ${String(match.id).slice(0, 8)}…)`);
    return { name, id: match.id };
  }

  if (!APPLY) { console.log(`  would CREATE ${name}`); return { name, id: '(new)' }; }
  const created = await vapi.createTool(body);
  local.id = created.id; writeJson(fullPath, local);
  console.log(`  created ${name} (id ${String(created.id).slice(0, 8)}…)`);
  return { name, id: created.id };
}

(async () => {
  console.log(`Vapi wire Ant Inbound ${APPLY ? '(APPLY)' : '(dry run — pass --apply to write)'}\n`);

  console.log('Ensuring our tools exist:');
  const ours = [];
  for (const f of DESIRED_TOOL_FILES) {
    try { const r = await ensureTool(f); if (r) ours.push(r); }
    catch (e) { console.error(`  FAIL ${f}: ${e.message}`); }
  }
  const ourIds = ours.map((t) => t.id).filter((id) => id && id !== '(new)');

  // Find Ant Inbound
  const aResp = await vapi.listAssistants();
  const assistants = Array.isArray(aResp) ? aResp : (aResp.results || aResp.assistants || []);
  const inbound = assistants.find((a) => (a.name || '').trim().toLowerCase() === INBOUND_NAME.toLowerCase());
  if (!inbound) { console.error(`\nCould not find an assistant named "${INBOUND_NAME}". Found: ${assistants.map((a) => a.name).join(', ')}`); process.exit(1); }

  const full = await vapi.getAssistant(inbound.id);
  const model = full.model || {};
  const beforeIds = Array.isArray(model.toolIds) ? model.toolIds : [];

  // Name the before-set for readability
  const allToolsResp = await vapi.listTools();
  const allTools = Array.isArray(allToolsResp) ? allToolsResp : (allToolsResp.results || allToolsResp.tools || []);
  const idToName = {}; allTools.forEach((t) => { idToName[t.id] = toolName(t); });

  console.log(`\nAnt Inbound (id ${String(inbound.id).slice(0, 8)}…)`);
  console.log(`  BEFORE toolIds (${beforeIds.length}): ${beforeIds.map((id) => idToName[id] || id.slice(0, 8)).join(', ') || '(none)'}`);
  console.log(`  AFTER  toolIds (${ourIds.length}): ${ours.map((t) => t.name).join(', ')}`);
  const dropping = beforeIds.filter((id) => !ourIds.includes(id)).map((id) => idToName[id] || id.slice(0, 8));
  if (dropping.length) console.log(`  detaching: ${dropping.join(', ')}`);

  if (!APPLY) { console.log('\nDry run only. Re-run with --apply to write.'); return; }
  if (ourIds.length < DESIRED_TOOL_FILES.length) { console.error('\nNot all tools resolved to ids — aborting before touching the assistant.'); process.exit(1); }

  const newModel = Object.assign({}, model, { toolIds: ourIds });
  await vapi.updateAssistant(inbound.id, { model: newModel });
  console.log('\n✅ Ant Inbound now has exactly our tools attached. transferCall/endCall (model.tools) left untouched.');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
