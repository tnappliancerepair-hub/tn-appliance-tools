#!/usr/bin/env node
// test-outbound-call — manually fire an outbound Vapi call from your
// terminal. Useful for testing assistants before wiring auto-triggers.
//
// Usage examples:
//   node scripts/test-outbound-call.js --assistant appointment_reminder \
//     --to +16154855795 \
//     --vars '{"customer_first_name":"Teddy","appliance_type":"washer","scheduled_when_human":"tomorrow at ten in the morning","tech_first_name":"Jimmy","job_id":18537}'
//
//   node scripts/test-outbound-call.js --assistant tech_running_late \
//     --to +16154855795 \
//     --vars '{"customer_first_name":"Teddy","tech_first_name":"Jimmy","minutes_behind":30,"new_eta_human":"around ten forty five","original_time_human":"ten in the morning","appliance_type":"refrigerator","job_id":18537}'
//
//   node scripts/test-outbound-call.js --assistant parts_eta_update \
//     --to +16154855795 \
//     --vars '{"customer_first_name":"Teddy","part_name_human":"the inverter compressor","appliance_type":"refrigerator","job_id":18537}'

import { placeOutboundCall, ASSISTANT_IDS } from '../colony-loop/vapi-out.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      out[k] = v;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv);

if (!args.assistant || !args.to) {
  console.error('Usage: node scripts/test-outbound-call.js --assistant <key> --to <phone> [--vars <json>] [--region TN|LA]');
  console.error('\nAvailable assistant keys:');
  for (const [k, id] of Object.entries(ASSISTANT_IDS)) {
    console.error(`  ${k.padEnd(28)} ${id}`);
  }
  process.exit(1);
}

const assistantId = ASSISTANT_IDS[args.assistant] || args.assistant; // accept raw UUID too
if (!assistantId) {
  console.error(`Unknown assistant: ${args.assistant}`);
  process.exit(1);
}

let variableValues = {};
if (args.vars) {
  try {
    variableValues = JSON.parse(args.vars);
  } catch (e) {
    console.error('--vars must be valid JSON:', e.message);
    process.exit(1);
  }
}

(async () => {
  console.log(`Placing call:`);
  console.log(`  assistant: ${args.assistant} (${assistantId.slice(0, 8)}…)`);
  console.log(`  to:        ${args.to}`);
  console.log(`  region:    ${args.region || 'TN (default)'}`);
  console.log(`  vars:      ${JSON.stringify(variableValues)}`);

  const result = await placeOutboundCall({
    assistantId,
    toPhone: args.to,
    fromRegion: args.region || 'TN',
    variableValues,
    metadata: { source: 'manual_test', triggered_at_ms: Date.now() },
  });

  if (result.ok) {
    console.log(`\n✅ Call placed. Vapi call_id: ${result.call_id}`);
    console.log(`   Pick up your phone. The agent should call you shortly.`);
  } else {
    console.error(`\n❌ Failed: ${result.error}`);
    if (result.status) console.error(`   HTTP ${result.status}`);
    process.exit(1);
  }
})();
