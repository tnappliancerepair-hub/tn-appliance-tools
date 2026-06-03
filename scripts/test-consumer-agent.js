#!/usr/bin/env node
// test-consumer-agent — runs TN Consumer Inbound scenarios end-to-end.
// Uses Anthropic API directly with the same prompt + tools that Vapi
// will use. Hits real Xano endpoints. Tests:
//   - lookup_customer_by_phone wired correctly
//   - tool selection per scenario
//   - warm tone, brand voice
//   - escalation triggers
//
// Usage:
//   node scripts/test-consumer-agent.js
//   node scripts/test-consumer-agent.js --scenario=2
//   node scripts/test-consumer-agent.js --verbose

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', 'colony-loop', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('ANTHROPIC_API_KEY missing in colony-loop/.env');
  process.exit(1);
}

const VAPI_ROOT = path.join(__dirname, '..', 'vapi-config');
const PROMPT = fs.readFileSync(path.join(VAPI_ROOT, 'prompts', 'ant_tn_consumer_inbound.md'), 'utf8');

const VERBOSE = process.argv.includes('--verbose');
const SCENARIO_ARG = process.argv.find((a) => a.startsWith('--scenario='));
const ONLY_SCENARIO = SCENARIO_ARG ? Number(SCENARIO_ARG.split('=')[1]) : null;

// Load tool definitions from this assistant's tools subset
const CONSUMER_TOOL_NAMES = new Set([
  'lookup_customer_by_phone',
  'get_job_arrival_status',
  'initiate_customer_reschedule',
  'start_new_intake',
  'check_service_zone',
]);

const TOOL_DIR = path.join(VAPI_ROOT, 'tools');
const tools = [];
for (const f of fs.readdirSync(TOOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const t = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, f), 'utf8'));
  if (t.function && t.function.name && CONSUMER_TOOL_NAMES.has(t.function.name) && t.server && t.server.url) {
    tools.push({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
      _url: t.server.url,
    });
  }
}

const anthropicTools = tools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

// Find a real existing customer phone for the "known customer" scenarios
// Fallback to a known-bogus phone for the "new customer" scenario.
const KNOWN_CUSTOMER_PHONE = '+16154855795'; // Teddy's number = always exists in customer table
const UNKNOWN_PHONE = '+15551234567';

const SCENARIOS = [
  {
    id: 1,
    name: 'Existing customer — status check',
    description: 'Known caller asks where their tech is. Tests lookup + arrival.',
    caller_phone: KNOWN_CUSTOMER_PHONE,
    transcript: [
      'Hey, calling to check on the tech for my appointment today.',
      'Yeah where is he right now?',
      'Okay thanks.',
    ],
    expect: {
      must_call_tools: ['lookup_customer_by_phone'],
      must_not_say: ['ballpark', 'apologize for the inconvenience'],
    },
  },
  {
    id: 2,
    name: 'Existing customer — reschedule',
    description: 'Known caller needs to move appointment. Tests reschedule flow.',
    caller_phone: KNOWN_CUSTOMER_PHONE,
    transcript: [
      'Hi I need to reschedule my appointment.',
      'Yeah something came up with my kids school, sorry.',
      'Yeah do that.',
    ],
    expect: {
      must_call_tools: ['lookup_customer_by_phone'],
      must_mention: [['three options', 'A, B', 'A B C', 'text you']],
    },
  },
  {
    id: 3,
    name: 'New customer — full intake',
    description: 'Unknown caller, washer broken in Antioch. Tests new intake flow.',
    caller_phone: UNKNOWN_PHONE,
    transcript: [
      'Hi my washer is broken can you guys come look at it.',
      "It's a Whirlpool, like 5 years old, it just won't drain.",
      "My name is Mike Johnson, zip is 37013.",
      'Yes that number is good.',
      'Sounds good thanks.',
    ],
    expect: {
      must_call_tools: ['lookup_customer_by_phone', 'check_service_zone', 'start_new_intake'],
      must_mention: [['text', 'options', 'office', 'send']],
    },
  },
  {
    id: 4,
    name: 'Out of area — honest decline',
    description: 'Caller in zip we do not service. Should be honest, offer escalation.',
    caller_phone: UNKNOWN_PHONE,
    transcript: [
      "Hi my fridge is broken, I'm in zip 90210.",
      'Yeah that is correct.',
      'No thanks.',
    ],
    expect: {
      must_call_tools: ['lookup_customer_by_phone', 'check_service_zone'],
      must_mention: [['not covering', "don't cover", 'unfortunately', 'not in our service area', "don't have a tech"]],
      must_not_call_tools: ['start_new_intake'],
    },
  },
  {
    id: 5,
    name: 'Angry caller — escalation',
    description: 'Caller mentions lawyer. Should transfer immediately.',
    caller_phone: KNOWN_CUSTOMER_PHONE,
    transcript: [
      "I'm absolutely furious, your tech damaged my floor and I'm going to talk to my lawyer.",
      'Yes transfer me now.',
    ],
    expect: {
      must_call_tools: ['transferCall'],
      must_mention: [['Teddy', 'owner', 'transfer']],
    },
  },
];

async function anthropicChat(messages, systemPrompt) {
  const body = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 700,
    temperature: 0.6,
    system: systemPrompt,
    messages,
    tools: anthropicTools,
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Anthropic ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

async function callTool(name, input) {
  if (name === 'transferCall') {
    return { synthetic: true, transferred_to: (input.transferTo || input.destinations || '+16154855795') };
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `unknown tool ${name}` };

  // GET vs POST: GET endpoints take querystring, POST take body
  const isGet = tool._url.includes('/check_service_zone') || tool._url.includes('/lookup_customer_by_phone') || tool._url.includes('/get_job_arrival_status');
  let r;
  if (isGet) {
    const qs = new URLSearchParams(input).toString();
    r = await fetch(`${tool._url}?${qs}`);
  } else {
    r = await fetch(tool._url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    });
  }
  if (!r.ok) {
    const text = await r.text();
    return { error: `tool ${name} ${r.status}: ${text.slice(0, 200)}` };
  }
  return r.json();
}

function blockText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
}

async function runScenario(scenario) {
  console.log(`\n━━━ Scenario ${scenario.id}: ${scenario.name} ━━━`);
  console.log(`     ${scenario.description}\n`);

  // Inject caller phone as the assistant's opening context
  const messages = [
    {
      role: 'user',
      content: `[CALLER_PHONE: ${scenario.caller_phone}] (call connected — caller has not spoken yet)`,
    },
    {
      role: 'assistant',
      content: 'Hey there, this is Ant at T-N Appliance Exchange — how can I help?',
    },
  ];
  console.log('🤖 Ant: "Hey there, this is Ant at T-N Appliance Exchange — how can I help?"');

  const toolsCalled = [];
  const agentReplies = [];

  for (const utterance of scenario.transcript) {
    messages.push({ role: 'user', content: utterance });
    console.log(`\n👤 Caller: "${utterance}"`);

    let safety = 0;
    while (safety++ < 10) {
      const resp = await anthropicChat(messages, PROMPT);
      messages.push({ role: 'assistant', content: resp.content });
      const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
      const textBlock = blockText(resp.content);
      if (textBlock) {
        agentReplies.push(textBlock);
        console.log(`🤖 Ant: "${textBlock}"`);
      }
      if (toolUses.length === 0) break;
      const toolResults = [];
      for (const tu of toolUses) {
        toolsCalled.push(tu.name);
        if (VERBOSE) console.log(`   → ${tu.name}(${JSON.stringify(tu.input)})`);
        const result = await callTool(tu.name, tu.input);
        if (VERBOSE) console.log(`   ← ${JSON.stringify(result).slice(0, 200)}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      if (resp.stop_reason !== 'tool_use') break;
    }
  }

  // Score
  const DIGIT_WORDS = { zero:'0', oh:'0', one:'1', two:'2', three:'3', four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9' };
  const normalize = (s) => {
    let t = String(s).toLowerCase();
    t = t.replace(/(\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b[\s-]*){2,}/g, (m) => m.split(/[\s-]+/).filter(Boolean).map((w) => DIGIT_WORDS[w] || w).join(''));
    return t;
  };
  const synonymHit = (phrase) => {
    const opts = Array.isArray(phrase) ? phrase : [phrase];
    return opts.some((p) => allText.includes(normalize(p)));
  };
  const expect = scenario.expect || {};
  const issues = [];
  const allText = normalize(agentReplies.join(' '));

  if (expect.must_call_tools) {
    for (const needed of expect.must_call_tools) {
      if (!toolsCalled.includes(needed)) issues.push(`MISSING tool: ${needed}`);
    }
  }
  if (expect.must_not_call_tools) {
    for (const forbidden of expect.must_not_call_tools) {
      if (toolsCalled.includes(forbidden)) issues.push(`FORBIDDEN tool called: ${forbidden}`);
    }
  }
  if (expect.must_mention) {
    for (const phrase of expect.must_mention) {
      if (!synonymHit(phrase)) issues.push(`MISSING mention: "${Array.isArray(phrase) ? phrase.join('|') : phrase}"`);
    }
  }
  if (expect.must_not_say) {
    for (const phrase of expect.must_not_say) {
      if (allText.includes(normalize(phrase))) issues.push(`FORBIDDEN phrase: "${phrase}"`);
    }
  }

  const pass = issues.length === 0;
  console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — tools called: ${toolsCalled.join(', ') || 'none'}`);
  if (!pass) issues.forEach((i) => console.log(`   ${i}`));
  return { scenario_id: scenario.id, pass, issues, toolsCalled };
}

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  Consumer Agent Test Orchestrator');
  console.log('═══════════════════════════════════════════');

  const results = [];
  for (const s of SCENARIOS) {
    if (ONLY_SCENARIO && s.id !== ONLY_SCENARIO) continue;
    try {
      const r = await runScenario(s);
      results.push(r);
    } catch (e) {
      console.error(`\n  SCENARIO ERROR: ${e.message}`);
      results.push({ scenario_id: s.id, pass: false, error: e.message });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n\n━━━ SUMMARY ━━━`);
  console.log(`  ${passed} / ${results.length} scenarios passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
