#!/usr/bin/env node
// wire-field-assist-live-tdr.js
// ----------------------------------------------------------------------------
// Makes "talk to Ant" the gold standard: gives the Ant Field Assist voice
// assistant (Brooke) the two tools to write the TDR LIVE, field-by-field, as
// the tech narrates — so the report fills in the tech tool + office in real
// time, not just at end-of-call. The end-of-call transcript backstop
// (vapi-webhook.js) stays as the safety net; this adds the live path.
//
// SAFE BY DEFAULT — DRY RUN. Prints exactly what it would change and changes
// nothing. Re-run with --apply to actually patch the assistant.
//
//   node colony-loop/scripts/wire-field-assist-live-tdr.js          # dry run
//   node colony-loop/scripts/wire-field-assist-live-tdr.js --apply  # do it
//
// Reads VAPI_PRIVATE_KEY from the environment or colony-loop/.env.
// Idempotent: re-running is a no-op once the tools + prompt line are present.
'use strict';

const fs = require('fs');
const path = require('path');

const VAPI = 'https://api.vapi.ai';
const ASSISTANT_ID = 'a22edcd1-495a-4d77-a66a-fb167997c70a'; // Ant Field Assist
const PROXY = 'https://tnapplianceexchange.net/.netlify/functions/vapi-tool';
const PROMPT_MARKER = '[[LIVE_TDR_SCRIBE]]';
const APPLY = process.argv.includes('--apply');

// --- load VAPI key (env first, then colony-loop/.env) ----------------------
function loadKey() {
  if (process.env.VAPI_PRIVATE_KEY) return process.env.VAPI_PRIVATE_KEY.trim();
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = txt.match(/^\s*VAPI_PRIVATE_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  } catch (_) {}
  return '';
}

// --- the two live-write tools ----------------------------------------------
const TOOLS = [
  {
    type: 'function',
    server: { url: PROXY },
    function: {
      name: 'update_tdr_field_from_voice',
      description:
        'Log ONE technician-report field the instant it becomes clear from what the tech says. ' +
        'Call this repeatedly during the call — once per field — so the report fills live in the ' +
        'tech app and the office. Use the job_id and technician_id from your call variables.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'number', description: 'Job id (from your {{job_id}} call variable).' },
          technician_id: { type: 'number', description: 'Tech id (from your {{tech_id}} call variable).' },
          field: {
            type: 'string',
            description:
              'Which field: diagnosis | failed_component | failure_cause | repair_completed | labor_hours | customer_notes',
          },
          value: { type: 'string', description: 'The plain-language value the tech just gave for that field.' },
        },
        required: ['job_id', 'field', 'value'],
      },
    },
  },
  {
    type: 'function',
    server: { url: PROXY },
    function: {
      name: 'save_tdr_final_from_voice',
      description:
        'Call ONCE at the very end — after the tech has covered the diagnosis, the failed part, what ' +
        'they did, and labor hours — to finalize the report and send it to the office. ' +
        'Use the job_id and technician_id from your call variables.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'number', description: 'Job id (from your {{job_id}} call variable).' },
          technician_id: { type: 'number', description: 'Tech id (from your {{tech_id}} call variable).' },
        },
        required: ['job_id'],
      },
    },
  },
];

const PROMPT_BLOCK =
  '\n\n' + PROMPT_MARKER + ' As the tech talks, silently log each report field with ' +
  'update_tdr_field_from_voice the moment it is clear (diagnosis, failed_component, failure_cause, ' +
  'repair_completed, labor_hours). Do not interrogate — capture what they volunteer, confirm briefly. ' +
  'When the tech signals they are done, call save_tdr_final_from_voice once. Always pass the job_id ' +
  'and technician_id from your call variables.';

async function vapi(method, path_, key, body) {
  const r = await fetch(`${VAPI}${path_}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 400) }; }
  return { ok: r.ok, status: r.status, json };
}

function toolName(t) { return (t && t.function && t.function.name) || (t && t.name) || ''; }

(async () => {
  const key = loadKey();
  if (!key) { console.error('✖ VAPI_PRIVATE_KEY not found (env or colony-loop/.env).'); process.exit(1); }

  console.log(`\n${APPLY ? '⚙️  APPLY MODE' : '🔍 DRY RUN (nothing will change)'} — Ant Field Assist (${ASSISTANT_ID})\n`);

  const got = await vapi('GET', `/assistant/${ASSISTANT_ID}`, key);
  if (!got.ok) { console.error('✖ Could not load assistant:', got.status, JSON.stringify(got.json).slice(0, 300)); process.exit(1); }

  const a = got.json;
  const model = a.model || {};
  const tools = Array.isArray(model.tools) ? model.tools.slice() : [];
  const have = new Set(tools.map(toolName));

  console.log('Current tools:', tools.map(toolName).filter(Boolean).join(', ') || '(none)');

  // 1) tools to add
  const toAdd = TOOLS.filter((t) => !have.has(toolName(t)));
  console.log('Tools to ADD:', toAdd.map(toolName).join(', ') || '(none — already wired)');

  // 2) prompt line
  const messages = Array.isArray(model.messages) ? model.messages.map((m) => Object.assign({}, m)) : [];
  let sys = messages.find((m) => m.role === 'system');
  const promptPresent = sys && typeof sys.content === 'string' && sys.content.includes(PROMPT_MARKER);
  console.log('Live-scribe prompt line:', promptPresent ? 'already present' : (sys ? 'WILL APPEND' : 'no system message found (will skip prompt edit)'));

  if (!toAdd.length && promptPresent) { console.log('\n✓ Nothing to do — already gold standard.\n'); return; }

  // Build patched model
  const newTools = tools.concat(toAdd);
  let newMessages = messages;
  if (sys && !promptPresent) { sys.content = String(sys.content || '') + PROMPT_BLOCK; }

  if (!APPLY) {
    console.log('\n--- DRY RUN: would PATCH the assistant with ---');
    console.log('  + tools:', newTools.map(toolName).filter(Boolean).join(', '));
    if (sys && !promptPresent) console.log('  + appended live-scribe line to the system prompt');
    console.log('\nRe-run with --apply to make it live. (Do this when NO tech is mid-call.)\n');
    return;
  }

  const patch = await vapi('PATCH', `/assistant/${ASSISTANT_ID}`, key,
    { model: Object.assign({}, model, { tools: newTools, messages: newMessages }) });
  if (!patch.ok) { console.error('✖ PATCH failed:', patch.status, JSON.stringify(patch.json).slice(0, 400)); process.exit(1); }

  const verify = await vapi('GET', `/assistant/${ASSISTANT_ID}`, key);
  const vtools = ((verify.json && verify.json.model && verify.json.model.tools) || []).map(toolName).filter(Boolean);
  console.log('\n✅ Applied. Tools now on the assistant:', vtools.join(', '));
  console.log('   Make ONE test call (tap "Talk to Ant" on any job) and watch the TDR fill live.\n');
})();
