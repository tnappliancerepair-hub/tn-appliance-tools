#!/usr/bin/env node
// vapi-inbound-prompt — manage Ant Inbound's SYSTEM PROMPT as code, so the
// prompt lives in git and pushes by command instead of pasting in the dashboard.
//
// SAFE WORKFLOW (do --pull first so git matches what's actually live):
//   node scripts/vapi-inbound-prompt.js --pull     # save LIVE prompt -> file
//   (edit vapi-config/prompts/ant_inbound.md)
//   node scripts/vapi-inbound-prompt.js            # dry run: live vs file sizes
//   node scripts/vapi-inbound-prompt.js --apply    # push file -> Ant Inbound
//
// Pulls/pushes ONLY the system message; voice, tools, model, transfers are
// untouched.

const fs = require('fs');
const path = require('path');
const vapi = require('../vapi-config/_lib/vapi-client');

const ROOT = path.join(__dirname, '..', 'vapi-config');
const PROMPT_FILE = path.join(ROOT, 'prompts', 'ant_inbound.md');
const INBOUND_NAME = 'Ant Inbound';
const PULL = process.argv.includes('--pull');
const APPLY = process.argv.includes('--apply');

function sysContent(model) {
  const msgs = (model && model.messages) || [];
  const sys = msgs.find((m) => m && m.role === 'system');
  return sys ? String(sys.content || '') : '';
}

(async () => {
  const aResp = await vapi.listAssistants();
  const assistants = Array.isArray(aResp) ? aResp : (aResp.results || aResp.assistants || []);
  const inbound = assistants.find((a) => (a.name || '').trim().toLowerCase() === INBOUND_NAME.toLowerCase());
  if (!inbound) { console.error(`No assistant named "${INBOUND_NAME}". Found: ${assistants.map((a) => a.name).join(', ')}`); process.exit(1); }

  const full = await vapi.getAssistant(inbound.id);
  const model = full.model || {};
  const liveText = sysContent(model);

  if (PULL) {
    fs.writeFileSync(PROMPT_FILE, liveText.endsWith('\n') ? liveText : liveText + '\n');
    console.log(`Pulled LIVE Ant Inbound prompt (${liveText.length} chars) -> vapi-config/prompts/ant_inbound.md`);
    console.log('Commit it, then edit the file and run --apply to push changes.');
    return;
  }

  if (!fs.existsSync(PROMPT_FILE)) { console.error(`Prompt file missing: ${PROMPT_FILE} — run --pull first.`); process.exit(1); }
  const fileText = fs.readFileSync(PROMPT_FILE, 'utf8').replace(/\s+$/, '');

  console.log(`Ant Inbound (id ${String(inbound.id).slice(0, 8)}…)`);
  console.log(`  LIVE prompt: ${liveText.length} chars`);
  console.log(`  FILE prompt: ${fileText.length} chars`);
  console.log(`  file first line: ${(fileText.split('\n')[0] || '').slice(0, 80)}`);
  if (Math.abs(liveText.length - fileText.length) > 400 && !PULL) {
    console.log('  ⚠ live and file differ a lot — if you have NOT --pull-ed the live prompt into the file yet, do that first so you do not overwrite the published prompt.');
  }

  if (!APPLY) { console.log('\nDry run. --apply to push the file to Ant Inbound. (Run --pull first if you have not captured the live prompt.)'); return; }

  const otherMsgs = (model.messages || []).filter((m) => m && m.role !== 'system');
  const newModel = Object.assign({}, model, { messages: [{ role: 'system', content: fileText }].concat(otherMsgs) });
  await vapi.updateAssistant(inbound.id, { model: newModel });
  console.log(`\n✅ Pushed prompt to Ant Inbound (${fileText.length} chars). Voice / tools / transfers untouched.`);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
