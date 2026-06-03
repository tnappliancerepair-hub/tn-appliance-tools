#!/usr/bin/env node
// test-csc-agent — runs scripted CSC scenarios end-to-end without
// requiring real phone calls. Uses Anthropic API directly with the SAME
// system prompt + tools that Vapi will use. When Claude wants to call a
// tool, we hit the real Xano endpoint via HTTP. This tests:
//   - Prompt logic (does the agent follow rules?)
//   - Tool selection (does it call the right tool at the right time?)
//   - Tool wiring (does the live Xano endpoint return what we expect?)
//   - Conversational flow (does it handle multi-turn correctly?)
//
// What it does NOT test: voice transcription accents (Deepgram), TTS
// pronunciation (ElevenLabs), call audio. Those need a real phone test.
//
// Usage:
//   node scripts/test-csc-agent.js                # all scenarios
//   node scripts/test-csc-agent.js --scenario=1   # just scenario 1
//   node scripts/test-csc-agent.js --verbose      # print every turn

const fs = require('fs');
const path = require('path');

// Load env
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
const PROMPT = fs.readFileSync(path.join(VAPI_ROOT, 'prompts', 'ant_csc_inbound.md'), 'utf8');

const VERBOSE = process.argv.includes('--verbose');
const SCENARIO_ARG = process.argv.find((a) => a.startsWith('--scenario='));
const ONLY_SCENARIO = SCENARIO_ARG ? Number(SCENARIO_ARG.split('=')[1]) : null;

// Load tool definitions
const TOOL_DIR = path.join(VAPI_ROOT, 'tools');
const tools = [];
for (const f of fs.readdirSync(TOOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const t = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, f), 'utf8'));
  if (t.function && t.function.name && t.server && t.server.url) {
    tools.push({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
      _url: t.server.url,
    });
  }
}

// Anthropic Messages API tools format
const anthropicTools = tools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

const SCENARIOS = [
  {
    id: 1,
    name: 'AHS status check — happy path',
    description: 'CSC calls about a real claim, wants status update. Tests lookup + status tools.',
    transcript: [
      "Hi, I'm calling from American Home Shield, I'm calling about claim four nine one three five six eight nine.",
      // Agent should: lookup claim → read back → call get_job_status_for_warranty → speak status
      "Okay, so what's the current status?",
      "Thank you, that's all I needed.",
    ],
    expect: {
      must_call_tools: ['lookup_by_claim_number', 'get_job_status_for_warranty'],
      must_mention: ['claim', '49135689', ['broadcasting', 'broadcast', 'intake', 'assigning', 'not yet scheduled', 'no tech', 'no technician']],
      must_not_say: ['ballpark', 'in the loop', 'swing by'],
    },
  },
  {
    id: 2,
    name: 'Claim not found — misheard digit',
    description: 'CSC gives a bogus claim. Agent should not hallucinate; should read back and offer to escalate.',
    transcript: [
      'Hi, I have claim number nine nine nine nine nine nine nine nine nine. What is the status?',
      'No, that is the right number.',
    ],
    expect: {
      must_call_tools: ['lookup_by_claim_number'],
      must_mention: [['no record', 'not find', 'unable to find', 'cannot find', "don't find"], ['office', 'transfer']],
    },
  },
  {
    id: 3,
    name: 'Parts status question',
    description: 'CSC asks specifically about parts. Tests get_parts_status routing.',
    transcript: [
      "Hi, I'm calling about claim four nine one three five six eight nine. When are the parts coming in?",
      'Thanks.',
    ],
    expect: {
      must_call_tools: ['lookup_by_claim_number', 'get_parts_status'],
      must_mention: ['parts'],
    },
  },
  {
    id: 4,
    name: 'Angry escalation',
    description: 'CSC says homeowner is threatening legal action. Agent must escalate to Teddy.',
    transcript: [
      'This is American Home Shield. The homeowner on claim four nine one three five six eight nine is threatening to sue. Can I speak to the owner?',
      'Yes please transfer me now.',
    ],
    expect: {
      must_call_tools: ['transferCall'],
      must_mention: ['transfer', 'owner', 'hold'],
    },
  },
  {
    id: 5,
    name: 'Reschedule history question',
    description: 'CSC asks why a job was rescheduled. Tests get_schedule_history.',
    transcript: [
      'Hi, ServicePower here. The homeowner says their job has been rescheduled three times for claim four nine one three five six eight nine. Why?',
      'Got it, thanks.',
    ],
    expect: {
      must_call_tools: ['lookup_by_claim_number', 'get_schedule_history'],
    },
  },
];

async function anthropicChat(messages, systemPrompt) {
  const body = {
    model: 'claude-opus-4-7',
    max_tokens: 800,
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
    // Synthetic — we don't actually transfer in a test
    return { synthetic: true, transferred_to: (input.transferTo || input.destinations || '+16154855795') };
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `unknown tool ${name}` };
  const r = await fetch(tool._url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
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

  const messages = [];
  const toolsCalled = [];
  const agentReplies = [];

  // Inject the assistant's opening line
  console.log('🤖 Ant: "Good morning, this is Ant at T-N Appliance Exchange. How can I help you?"');

  for (const cscUtterance of scenario.transcript) {
    messages.push({ role: 'user', content: cscUtterance });
    console.log(`\n👤 CSC: "${cscUtterance}"`);

    // Loop: keep handling tool calls until Claude produces final text
    let safety = 0;
    while (safety++ < 10) {
      const resp = await anthropicChat(messages, PROMPT);
      const stop_reason = resp.stop_reason;
      messages.push({ role: 'assistant', content: resp.content });

      // Process tool uses
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
        if (VERBOSE) console.log(`   → calling ${tu.name}(${JSON.stringify(tu.input)})`);
        const result = await callTool(tu.name, tu.input);
        if (VERBOSE) console.log(`   ← ${JSON.stringify(result).slice(0, 200)}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      messages.push({ role: 'user', content: toolResults });

      if (stop_reason !== 'tool_use') break;
    }
  }

  // Score the scenario.
  // normalize for digit-by-digit spoken forms: "four-nine-one" → "491"
  const DIGIT_WORDS = {
    zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  };
  const normalize = (s) => {
    let t = String(s).toLowerCase();
    // Replace "four-nine" or "four nine" digit groups with concatenated digits
    t = t.replace(/(\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b[\s-]*){2,}/g, (m) => {
      return m.split(/[\s-]+/).filter(Boolean).map((w) => DIGIT_WORDS[w] || w).join('');
    });
    return t;
  };

  const expect = scenario.expect || {};
  const issues = [];
  const allText = normalize(agentReplies.join(' '));

  if (expect.must_call_tools) {
    for (const needed of expect.must_call_tools) {
      if (!toolsCalled.includes(needed)) {
        issues.push(`MISSING tool: ${needed} (was called: ${toolsCalled.join(', ') || 'none'})`);
      }
    }
  }
  // Accept any of an array of synonym phrases (any one match counts)
  const synonymHit = (phrase) => {
    const opts = Array.isArray(phrase) ? phrase : [phrase];
    return opts.some((p) => allText.includes(normalize(p)));
  };
  if (expect.must_mention) {
    for (const phrase of expect.must_mention) {
      if (!synonymHit(phrase)) {
        issues.push(`MISSING mention: "${Array.isArray(phrase) ? phrase.join('|') : phrase}"`);
      }
    }
  }
  if (expect.must_not_say) {
    for (const phrase of expect.must_not_say) {
      if (allText.includes(normalize(phrase))) {
        issues.push(`FORBIDDEN phrase used: "${phrase}"`);
      }
    }
  }
  if (expect.must_not_mention) {
    for (const phrase of expect.must_not_mention) {
      if (allText.includes(normalize(phrase))) {
        issues.push(`SHOULD NOT mention: "${phrase}"`);
      }
    }
  }

  const pass = issues.length === 0;
  console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — tools called: ${toolsCalled.join(', ') || 'none'}`);
  if (!pass) {
    for (const i of issues) console.log(`   ${i}`);
  }
  return { scenario_id: scenario.id, pass, issues, toolsCalled, replies: agentReplies };
}

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  CSC Agent Test Orchestrator');
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
