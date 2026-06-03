// vapi_call_review — closed-loop reinforcement foundation.
// Fires daily (via tick.js DAILY_VAPI_CALL_REVIEW signal).
// 1. Pulls the previous 24h of completed Vapi calls via Vapi REST.
// 2. For each call, sends the transcript + assistant + outcome to
//    Claude Sonnet 4.5 with a structured rubric.
// 3. Writes one event_log row per call with the structured review.
// 4. Aggregates patterns by assistant and SMSes Teddy a daily digest.
//
// Output rubric per call (1-5 each):
//   outcome_quality, tool_use_accuracy, brand_voice, factual_accuracy,
//   efficiency, plus a one-sentence improvement_idea.

import { config } from '../config.js';
import * as xano from '../xano.js';
import * as claude from '../claude.js';
import { toOwner } from '../sms.js';

const VAPI_BASE = 'https://api.vapi.ai';

async function vapiGet(path) {
  const r = await fetch(`${VAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${config.vapiPrivateKey}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Vapi ${path} ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

function shortMs(ms) {
  if (!ms) return '?';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60}s`;
}

const RUBRIC_PROMPT = `You are reviewing a phone call between Ant (an AI voice agent at TN Appliance Exchange) and a caller. Score the call on five dimensions, 1-5 each. Then give ONE specific improvement idea (or "none" if it was great).

Dimensions:
1. outcome_quality — did the call resolve the caller's need? (5 = fully resolved, 1 = caller hung up frustrated)
2. tool_use_accuracy — did the agent call the right tools at the right time? (5 = exact, 1 = guessed instead of looking up)
3. brand_voice — warm, calm, capable, NOT scripted-sounding. (5 = sounded like a sharp friend, 1 = robotic / corporate)
4. factual_accuracy — everything spoken was true / sourced from tools. (5 = perfect, 1 = hallucinated claims)
5. efficiency — respected the caller's time, didn't waste turns. (5 = tight, 1 = long meandering)

Reply ONLY with this exact JSON shape (no other text):
{
  "outcome_quality": <1-5>,
  "tool_use_accuracy": <1-5>,
  "brand_voice": <1-5>,
  "factual_accuracy": <1-5>,
  "efficiency": <1-5>,
  "improvement_idea": "<one sentence or 'none'>",
  "tldr": "<one sentence summary of the call>"
}`;

function buildReviewInput(call) {
  const msgs = call.messages || call.transcript || [];
  let transcript;
  if (Array.isArray(msgs)) {
    transcript = msgs
      .filter((m) => m && (m.role || m.message))
      .map((m) => {
        const who = m.role === 'assistant' || m.role === 'bot' ? 'AGENT' : m.role === 'tool_calls' ? 'TOOL' : 'CALLER';
        return `${who}: ${(m.message || m.content || '').toString().slice(0, 500)}`;
      })
      .join('\n')
      .slice(0, 8000);
  } else {
    transcript = String(msgs).slice(0, 8000);
  }
  const dur = call.endedAt && call.startedAt ? new Date(call.endedAt) - new Date(call.startedAt) : 0;
  return `ASSISTANT: ${(call.assistant && call.assistant.name) || '?'}
DURATION: ${shortMs(dur)}
END REASON: ${call.endedReason || '?'}

TRANSCRIPT:
${transcript}`;
}

function safeJson(text) {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function reviewOneCall(call) {
  if (!call.messages && !call.transcript) return { skipped: 'no_transcript' };
  const input = buildReviewInput(call);
  const resp = await claude.complete({
    model: 'sonnet',
    system: RUBRIC_PROMPT,
    messages: [{ role: 'user', content: input }],
    maxTokens: 400,
  });
  const review = safeJson(resp);
  if (!review) return { skipped: 'unparseable' };
  return { review };
}

export async function run(signal) {
  if (!config.vapiPrivateKey) {
    await xano.logLocal('vapi_call_review_skipped', { reason: 'no_vapi_key' });
    return { ok: false, outcome: 'no_vapi_key' };
  }

  const since = Date.now() - 24 * 3600 * 1000;
  const sinceIso = new Date(since).toISOString();

  let list;
  try {
    list = await vapiGet(`/call?createdAtGt=${encodeURIComponent(sinceIso)}&limit=100`);
  } catch (e) {
    await xano.logLocal('vapi_call_review_fetch_failed', { error: e.message.slice(0, 200) });
    return { ok: false, outcome: 'vapi_fetch_failed' };
  }

  const calls = Array.isArray(list) ? list : (list.results || []);
  if (calls.length === 0) {
    await xano.logLocal('vapi_call_review_no_calls', { window_hours: 24 });
    return { ok: true, outcome: 'no_calls' };
  }

  const byAssistant = {};
  let reviewed = 0;
  let skipped = 0;
  const sampleIdeas = [];

  for (const c of calls) {
    if (c.status !== 'ended' && c.endedAt == null) {
      skipped++;
      continue;
    }
    try {
      const { review, skipped: skipReason } = await reviewOneCall(c);
      if (skipReason) {
        skipped++;
        continue;
      }
      reviewed++;
      const assistantName = (c.assistant && c.assistant.name) || c.assistantId || 'unknown';
      if (!byAssistant[assistantName]) {
        byAssistant[assistantName] = {
          count: 0,
          sums: { outcome_quality: 0, tool_use_accuracy: 0, brand_voice: 0, factual_accuracy: 0, efficiency: 0 },
          ideas: [],
        };
      }
      const slot = byAssistant[assistantName];
      slot.count++;
      for (const k of Object.keys(slot.sums)) slot.sums[k] += Number(review[k] || 0);
      if (review.improvement_idea && review.improvement_idea !== 'none' && slot.ideas.length < 5) {
        slot.ideas.push(review.improvement_idea);
        if (sampleIdeas.length < 8) sampleIdeas.push(`[${assistantName}] ${review.improvement_idea}`);
      }
      await xano.logLocal('vapi_call_reviewed', {
        call_id: c.id,
        assistant_name: assistantName,
        outcome_quality: review.outcome_quality,
        tool_use_accuracy: review.tool_use_accuracy,
        brand_voice: review.brand_voice,
        factual_accuracy: review.factual_accuracy,
        efficiency: review.efficiency,
        tldr: review.tldr,
        improvement_idea: review.improvement_idea,
      });
    } catch (e) {
      skipped++;
      await xano.logLocal('vapi_call_review_error', { call_id: c.id, error: e.message.slice(0, 200) });
    }
  }

  const lines = [`[ant] vapi-review last 24h — ${reviewed} reviewed, ${skipped} skipped`];
  for (const [name, slot] of Object.entries(byAssistant)) {
    const avgs = Object.fromEntries(
      Object.entries(slot.sums).map(([k, v]) => [k, +(v / slot.count).toFixed(1)])
    );
    lines.push(`${name} (n=${slot.count}): outcome ${avgs.outcome_quality} · brand ${avgs.brand_voice} · accuracy ${avgs.factual_accuracy} · tools ${avgs.tool_use_accuracy} · efficiency ${avgs.efficiency}`);
  }
  if (sampleIdeas.length) {
    lines.push('TOP IDEAS:');
    sampleIdeas.slice(0, 5).forEach((i, idx) => lines.push(`${idx + 1}. ${i}`));
  }
  const digest = lines.join('\n').slice(0, 1400);

  if (reviewed > 0) {
    await toOwner(digest, { source: 'vapi_call_review' });
  }

  await xano.logLocal('vapi_call_review_completed', {
    reviewed,
    skipped,
    assistants: Object.keys(byAssistant).length,
    ideas_surfaced: sampleIdeas.length,
  });

  return { ok: true, reviewed, skipped };
}
