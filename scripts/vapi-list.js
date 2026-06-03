#!/usr/bin/env node
// vapi-list — quick read-only snapshot of what's in Vapi today.
// Shows assistants, phone numbers, and their routing.

const vapi = require('../vapi-config/_lib/vapi-client');

(async () => {
  console.log('\n=== ASSISTANTS ===');
  const aList = await vapi.listAssistants();
  const assistants = Array.isArray(aList) ? aList : (aList.results || []);
  for (const a of assistants) {
    const model = a.model && a.model.model ? a.model.model : '?';
    const transcriber = a.transcriber && a.transcriber.model ? a.transcriber.model : (a.transcriber && a.transcriber.provider) || '?';
    const voice = a.voice && (a.voice.voiceId || a.voice.voice) ? (a.voice.voiceId || a.voice.voice) : '?';
    console.log(`  ${a.name || '(unnamed)'}`);
    console.log(`    id: ${a.id}`);
    console.log(`    model: ${model}  transcriber: ${transcriber}  voice: ${voice}`);
    console.log(`    tools: ${(a.model && a.model.toolIds || a.tools || []).length || 0}`);
  }

  console.log('\n=== PHONE NUMBERS ===');
  const pList = await vapi.listPhoneNumbers();
  const phones = Array.isArray(pList) ? pList : (pList.results || []);
  for (const p of phones) {
    const asg = p.assistantId || '(none)';
    const asgName = assistants.find((a) => a.id === asg);
    console.log(`  ${p.number || '(no #)'} → ${asgName ? asgName.name : asg}`);
    console.log(`    id: ${p.id}  provider: ${p.provider || '?'}`);
  }

  console.log('\n=== TOOLS ===');
  const tList = await vapi.listTools();
  const tools = Array.isArray(tList) ? tList : (tList.results || []);
  for (const t of tools) {
    const fn = t.function && t.function.name ? t.function.name : t.name || '?';
    const tp = t.type || '?';
    console.log(`  ${fn}  [${tp}]  id=${t.id}`);
  }
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
