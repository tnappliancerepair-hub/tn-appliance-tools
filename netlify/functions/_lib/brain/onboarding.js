// Ant Tech Scheduler — onboarding-mode brain.
//
// Migrated from the broken Xano endpoint
//   xano-workspace/api/scheduling/tech_sms_inbound_POST.xs (onboarding branch, lines ~138-455)
// to Netlify after the unresolved-references corruption made that endpoint
// unusable. See:
//   docs/xano-deploy-corruption-explained-2026-05-20.md
//   docs/tech-sms-migration-design-onboarding-2026-05-20.md
//   docs/tech-sms-migration-inventory-onboarding-2026-05-20.md
//
// Behavior is identical to the source endpoint's onboarding branch.
// Daily mode is NOT here (scoped for tomorrow). Daily-mode techs return
// { fallthrough: true } so the caller routes them to the legacy path.
//
// Includes Fix 1 (empty-reply guard), Fix 2 (defensive Anthropic response
// access + event_log on error), Fix 3 (multi-block ADD_PREFERENCE).

'use strict';

const fs = require('fs');
const path = require('path');
const crud = require('../xano/metadata-crud');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';   // pinned for behavior parity
const ANTHROPIC_MAX_TOKENS = 1024;
const ANTHROPIC_TIMEOUT_MS = 8000;
const HISTORY_LIMIT = 20;

// ─── PROMPT LOADING ───────────────────────────────────────────────────
// The onboarding system prompt is too large for Netlify env vars
// (5000-char cap). We store it as a co-located file and read it ONCE at
// module-load time. Fallback to env var if the file is missing/empty,
// which keeps the option open if we ever land on a Netlify plan with
// larger env var limits OR want to override the file value in a single
// deploy context.
const PROMPT_FILE_PATH = path.join(__dirname, 'onboarding-prompt.md');
let PROMPT;
try {
  PROMPT = fs.readFileSync(PROMPT_FILE_PATH, 'utf8').trim();
  // Still the placeholder? Treat as empty so the fallback kicks in.
  if (PROMPT.startsWith('<!--')) PROMPT = '';
} catch (e) {
  PROMPT = '';
}
if (!PROMPT) PROMPT = process.env.ANT_TECH_ONBOARDING_PROMPT || '';
if (!PROMPT) {
  console.error('[brain.onboarding] NO PROMPT LOADED — Claude will get empty system');
}

const UNKNOWN_PHONE_REPLY =
  "this number isn't recognized as a tech. if you meant to text the company line about service, call 615-280-2949.";
const RETRY_REPLY = 'hey, signal hiccup on my end. text that again in a sec?';
const EMPTY_GUARD_REPLY = 'got it.';
const LOOKUP_FAIL_REPLY = 'having trouble looking you up. try in a min or text teddy 615-485-5795.';
const CONV_FAIL_REPLY = 'having trouble starting our chat. try again in a sec?';

// ─── PUBLIC ENTRY ─────────────────────────────────────────────────────

async function runOnboardingTurn({ phone, body, sid, to }) {
  if (!phone || !body) {
    return { reply: RETRY_REPLY };
  }

  // 1. Phone lookup
  let tech;
  try {
    tech = await crud.getTechByPhone(phone);
  } catch (e) {
    console.error('[brain.onboarding] getTechByPhone failed:', e.message);
    return { reply: LOOKUP_FAIL_REPLY };
  }

  if (!tech) {
    return { reply: UNKNOWN_PHONE_REPLY };
  }

  // 2. Daily-mode techs fall through to the legacy path
  if (tech.onboarding_completed_at) {
    return { fallthrough: true };
  }

  // 3. Find or create conversation
  let conversation;
  try {
    conversation = await crud.findOrCreateTechConversation(tech.id, 'sms');
  } catch (e) {
    console.error('[brain.onboarding] findOrCreateTechConversation failed:', e.message);
    return { reply: CONV_FAIL_REPLY };
  }

  // 4. Persist user message (continue even if persist fails — reply still goes out)
  try {
    await crud.addAgentMessage(conversation.id, 'user', body);
  } catch (e) {
    console.warn('[brain.onboarding] user message persist failed (continuing):', e.message);
    crud.logEvent('tech_sms_inbound_user_persist_fail', {
      tech_id: tech.id,
      conversation_id: conversation.id,
      error: e.message,
      body_preview: body.slice(0, 200),
    });
  }

  // 5. Pull recent history (cap 20). Empty rows filtered out so a prior
  //    poisoned message can't crash Anthropic with "empty assistant content".
  let history = [];
  try {
    const raw = await crud.getRecentTechMessages(conversation.id, HISTORY_LIMIT);
    history = raw.filter((m) => m && m.content && String(m.content).trim().length > 0);
  } catch (e) {
    console.warn('[brain.onboarding] history fetch failed, using empty (continuing):', e.message);
    history = [];
  }

  // 6. Call Anthropic with Fix-2 defensive access
  const claudeMessages = history.map((m) => ({ role: m.role, content: m.content }));
  // Make sure the LAST message is the current user turn (in case the persist
  // above failed and the history doesn't include it).
  const lastTurn = claudeMessages[claudeMessages.length - 1];
  if (!lastTurn || lastTurn.role !== 'user' || lastTurn.content !== body) {
    claudeMessages.push({ role: 'user', content: body });
  }

  let replyText;
  try {
    const r = await callAnthropic(claudeMessages);
    if (r.status >= 200 && r.status < 300) {
      const content = (r.body && r.body.content) || [];
      const first = content[0];
      replyText = (first && first.text) || '';
    } else {
      // Fix 2: log Claude error + substitute canned retry
      console.error('[brain.onboarding] anthropic non-2xx:', r.status, JSON.stringify(r.body).slice(0, 300));
      await crud.logEvent('tech_sms_inbound_claude_error', {
        tech_id: tech.id,
        conversation_id: conversation.id,
        status: r.status,
        error_body: r.body,
        user_message_preview: body.slice(0, 200),
        mode: 'onboarding',
      });
      replyText = RETRY_REPLY;
    }
  } catch (e) {
    console.error('[brain.onboarding] anthropic threw:', e.message);
    await crud.logEvent('tech_sms_inbound_claude_error', {
      tech_id: tech.id,
      conversation_id: conversation.id,
      status: 0,
      error_body: { thrown: e.message },
      user_message_preview: body.slice(0, 200),
      mode: 'onboarding',
    });
    replyText = RETRY_REPLY;
  }

  // 7. Token dispatch (only when Claude returned real text)
  let cleanReply = replyText;
  if (replyText && replyText !== RETRY_REPLY) {
    cleanReply = await applyTokens(replyText, tech.id);
  }

  // 8. Trim + Fix 1 empty-reply guard
  cleanReply = (cleanReply || '').trim();
  if (cleanReply.length === 0) {
    cleanReply = EMPTY_GUARD_REPLY;
  }

  // 9. Persist assistant message (non-fatal if it fails)
  try {
    await crud.addAgentMessage(conversation.id, 'assistant', cleanReply);
  } catch (e) {
    console.warn('[brain.onboarding] assistant persist failed (reply still goes out):', e.message);
    crud.logEvent('tech_sms_inbound_assistant_persist_fail', {
      tech_id: tech.id,
      conversation_id: conversation.id,
      error: e.message,
      reply_preview: cleanReply.slice(0, 200),
    });
  }

  return { reply: cleanReply };
}

// ─── ANTHROPIC CALL ───────────────────────────────────────────────────

async function callAnthropic(messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var not set');
  if (!PROMPT) throw new Error('onboarding prompt not loaded (file and env both empty)');
  const systemPrompt = PROMPT;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
    return { status: res.status, body };
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') {
      throw new Error('anthropic timeout after ' + ANTHROPIC_TIMEOUT_MS + 'ms');
    }
    throw e;
  }
}

// ─── TOKEN DISPATCH ───────────────────────────────────────────────────

// Token order: SET_HOURS → SET_SUMMARY_TIME → SET_PERSONAL_CONTEXT → ADD_PREFERENCE (multi) → ONBOARDING_DONE
async function applyTokens(rawReply, techId) {
  let cleanReply = rawReply;

  cleanReply = await handlePairedToken(cleanReply, rawReply, '__SET_HOURS__', async (data) => {
    if (data && (data.start != null || data.end != null)) {
      const fields = {};
      if (data.start != null) fields.preferred_hours_start = data.start;
      if (data.end != null)   fields.preferred_hours_end   = data.end;
      try { await crud.updateTechFields(techId, fields); }
      catch (e) { logTokenFail('SET_HOURS', techId, fields, e); }
    }
  }, { multi: false });

  cleanReply = await handlePairedToken(cleanReply, rawReply, '__SET_SUMMARY_TIME__', async (data) => {
    if (data && data.time != null) {
      try { await crud.updateTechFields(techId, { daily_summary_time: data.time }); }
      catch (e) { logTokenFail('SET_SUMMARY_TIME', techId, { daily_summary_time: data.time }, e); }
    }
  }, { multi: false });

  cleanReply = await handlePairedToken(cleanReply, rawReply, '__SET_PERSONAL_CONTEXT__', async (data) => {
    if (data && data.text != null) {
      try { await crud.updateTechFields(techId, { personal_context: data.text }); }
      catch (e) { logTokenFail('SET_PERSONAL_CONTEXT', techId, { personal_context: data.text }, e); }
    }
  }, { multi: false });

  // Fix 3: ADD_PREFERENCE may appear multiple times in one turn
  cleanReply = await handlePairedToken(cleanReply, rawReply, '__ADD_PREFERENCE__', async (data) => {
    if (data && data.preference_type) {
      try {
        await crud.addTechPreference({
          tech_id: techId,
          preference_type: data.preference_type,
          zip_or_area: data.zip_or_area,
          day_of_week: data.day_of_week,
          time_window_start: data.time_window_start,
          time_window_end: data.time_window_end,
          strength: data.strength,
          source: data.source || 'explicit',
          captured_via_text: data.captured_via_text,
        });
      } catch (e) {
        logTokenFail('ADD_PREFERENCE', techId, data, e);
      }
    }
  }, { multi: true });

  // ONBOARDING_DONE — bare token, no JSON body
  if (rawReply.indexOf('__ONBOARDING_DONE__') >= 0) {
    try { await crud.updateTechFields(techId, { onboarding_completed_at: Date.now() }); }
    catch (e) { logTokenFail('ONBOARDING_DONE', techId, {}, e); }
    cleanReply = cleanReply.split('__ONBOARDING_DONE__').join('');
  }

  return cleanReply;
}

// handlePairedToken — iterates every paired-token block in rawReply, parses
// the JSON body, invokes the action, and returns cleanReply with every
// paired block stripped out.
//
// `multi: false` invokes the action only for the FIRST paired block (mirrors
// source single-shot behavior for SET_HOURS / SET_SUMMARY_TIME /
// SET_PERSONAL_CONTEXT). `multi: true` invokes for every block (Fix 3).
//
// Cleanup uses the same split-and-rejoin algorithm so the regex is irrelevant;
// every paired block disappears either way.
async function handlePairedToken(cleanReply, rawReply, token, action, opts) {
  if (rawReply.indexOf(token) < 0) return cleanReply;

  const parts = rawReply.split(token);
  // Paired-token shape: split yields [text, JSON1, text, JSON2, text, ...].
  // Odd-indexed elements are JSON bodies.
  let firedOnce = false;
  for (let i = 1; i < parts.length; i += 2) {
    if (!opts.multi && firedOnce) break;
    const jsonStr = (parts[i] || '').trim();
    let data = null;
    try { data = JSON.parse(jsonStr); }
    catch (_) { /* malformed, skip */ }
    if (data) {
      try { await action(data); }
      catch (e) { console.warn('[brain.onboarding] token action threw for ' + token + ':', e.message); }
      firedOnce = true;
    }
  }

  // Strip every paired block via split-rejoin: keep even-indexed parts only.
  const keep = [];
  for (let i = 0; i < parts.length; i += 2) keep.push(parts[i]);
  return keep.join('');
}

function logTokenFail(tokenName, techId, payload, err) {
  console.error('[brain.onboarding] token ' + tokenName + ' write failed:', err.message);
  crud.logEvent('tech_sms_inbound_token_write_fail', {
    token: tokenName,
    tech_id: techId,
    payload,
    error: err.message,
    status: err.status,
    error_body: err.body,
  });
}

module.exports = { runOnboardingTurn };
