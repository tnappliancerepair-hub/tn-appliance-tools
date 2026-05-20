# tech_sms_inbound migration — onboarding-mode design

**Companion to:** `docs/tech-sms-migration-inventory-onboarding-2026-05-20.md`
**Scope:** onboarding mode only. Daily mode is tomorrow.

---

## Architecture summary

```
Telnyx / Twilio webhook
   │
   ▼
netlify/functions/tech-sms-inbound.js    (existing thin proxy, modified — feature-flag dispatch)
   │
   ▼  (when TECH_SMS_BRAIN_V2 == "true")
netlify/functions/_lib/brain/onboarding.js   (NEW — the brain)
   │
   ├─► fetch Anthropic   (https://api.anthropic.com/v1/messages, env ANTHROPIC_API_KEY)
   └─► fetch small Xano CRUD endpoints (each <50 lines XanoScript)
            │
            ▼
         Xano tables  (technicians, agent_conversation, agent_message, tech_preferences, event_log)
```

Old path stays available for instant rollback:
```
   │  (when TECH_SMS_BRAIN_V2 != "true" — default)
   ▼
Xano tech_sms_inbound   (the broken 2142-line file — keeps current behavior on the unaffected daily-mode techs, and onboarding techs hit FALLBACK_REPLY as they do today)
```

---

## Routing strategy — recommended

**Feature flag inside `tech-sms-inbound.js`.** New env var `TECH_SMS_BRAIN_V2` on Netlify. When `"true"`, the function `require`s the brain module and runs it in-process. Otherwise it does the current forward to Xano `tech_sms_inbound`.

### Why this over the alternatives

| Approach | Rollback speed | Webhook reconfig | Risk |
|---|---|---|---|
| **Feature flag (recommended)** | Instant — flip env var | None | Both paths live in one file; well-contained |
| Replace inline | Slow — git revert + redeploy | None | Old path lost; no parallel safety |
| New webhook URL (point Telnyx at `/tech-sms-inbound-v2`) | Medium — flip URL in Telnyx portal | Required, per-provider | Two functions to maintain; webhook misconfiguration risk |

Feature flag wins on rollback ergonomics. T can flip back in ~10 seconds via Netlify UI if anything misbehaves.

### Two-environment safety variant (also recommended)

While we test, set `TECH_SMS_BRAIN_V2=true` ONLY for a specific tech (Jimmy first, as test subject) and let everyone else hit the old path. Implementation: a second env var `TECH_SMS_BRAIN_V2_PHONES` containing comma-separated bare 10-digit phones. The flag check becomes:

```js
const v2Enabled = process.env.TECH_SMS_BRAIN_V2 === 'true';
const v2Phones = (process.env.TECH_SMS_BRAIN_V2_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
const useBrain = v2Enabled && (v2Phones.length === 0 || v2Phones.includes(bareDigits(parsed.from)));
```

Day 1 staged rollout: `TECH_SMS_BRAIN_V2=true` + `TECH_SMS_BRAIN_V2_PHONES=6159671304` (Jimmy only). When verified, blank `TECH_SMS_BRAIN_V2_PHONES` to enable for everyone.

---

## File layout

```
netlify/functions/
├── tech-sms-inbound.js              (modified — adds feature-flag dispatch)
├── tech-sms-inbound-v2.js           (NEW — optional parallel webhook entrypoint, same brain)
└── _lib/
    ├── brain/
    │   └── onboarding.js            (NEW — the brain; exports runOnboardingTurn)
    └── xano/
        └── scheduling-crud.js       (NEW — thin wrappers around the 7 small Xano endpoints)
```

**Why `_lib/`?** Netlify function-discovery skips underscore-prefixed directories. Modules live here without being deployed as their own webhook URLs.

**Why a separate `tech-sms-inbound-v2.js`?** Optional. Gives T the alternate routing path (point Telnyx at it directly during testing) without disrupting the v1 webhook URL. If we end up only ever using the feature flag, this file can be deleted. Both files just delegate to `_lib/brain/onboarding.js` — no duplicated brain logic.

---

## Xano endpoints needed (7 endpoints)

All new endpoints sit in api_group `scheduling`. All under 50 lines of XanoScript. Each is a single db.* call wrapped in trivial input validation.

### E1. `get_tech_by_phone` — POST

**Input:** `text phone`
**Output:** `{ tech: <tech row | null>, matched_on: "exact"|"fallback"|"none" }`

```xanoscript
query get_tech_by_phone verb=POST {
  api_group = "scheduling"
  input { text phone filters=trim }

  stack {
    db.query technicians {
      where = $db.technicians.phone == $input.phone
      return = {type: "single"}
    } as $exact

    var $tech { value = $exact }
    var $matched_on { value = "exact" }

    conditional {
      if ($exact == null) {
        var $bare { value = $input.phone|replace:"+1":"" }
        db.query technicians {
          where = $db.technicians.active == true && ($db.technicians.phone == $input.phone || $db.technicians.phone == $bare)
          return = {type: "single"}
        } as $fallback
        var.update $tech { value = $fallback }
        var.update $matched_on { value = ($fallback != null) ? "fallback" : "none" }
      }
    }
  }

  response = { tech: $tech, matched_on: $matched_on }
}
```

**Line count:** ~28. Well under 50.
**Failure mode:** if Xano returns 5xx, brain returns canned `"hey, having trouble looking you up. try in a min or text teddy 615-485-5795."` and skips the rest of the turn (no DB writes).

---

### E2. `find_or_create_tech_conversation` — POST

**Input:** `int tech_id, text channel` (channel defaults to `"sms"` if missing)
**Output:** `{ conversation: <row>, created: bool }`

```xanoscript
query find_or_create_tech_conversation verb=POST {
  api_group = "scheduling"
  input {
    int tech_id
    text? channel?
  }

  stack {
    var $ch { value = (($input.channel ?? "")|first_notempty:"sms") }

    db.query agent_conversation {
      where = $db.agent_conversation.tech_id == $input.tech_id && $db.agent_conversation.channel == $ch
      sort = {agent_conversation.created_at: "desc"}
      return = {type: "single"}
    } as $existing

    var $conv { value = $existing }
    var $created { value = false }

    conditional {
      if ($existing == null) {
        var $session_id { value = "tech_" ~ ($input.tech_id|to_text) ~ "_" ~ ((now|to_ms)|to_text) }
        db.add agent_conversation {
          data = {
            tech_id        : $input.tech_id
            channel        : $ch
            title          : "Tech SMS"
            last_message_at: now
            session_id     : $session_id
          }
        } as $new_conv
        var.update $conv { value = $new_conv }
        var.update $created { value = true }
      }
    }
  }

  response = { conversation: $conv, created: $created }
}
```

**Line count:** ~35.
**Failure mode:** retry once with a 500ms backoff. If still 5xx, brain returns canned `"having trouble starting our chat. try again in a sec?"` and skips the turn.

---

### E3. `add_agent_message` — POST

**Input:** `int conversation_id, text role, text content`
**Output:** `{ message: <new row> }`

```xanoscript
query add_agent_message verb=POST {
  api_group = "scheduling"
  input {
    int conversation_id
    text role filters=trim
    text content
  }

  stack {
    db.add agent_message {
      data = {
        conversation_id: $input.conversation_id
        role           : $input.role
        content        : $input.content
      }
    } as $msg

    db.edit agent_conversation {
      field_name = "id"
      field_value = $input.conversation_id
      data = {last_message_at: now}
    } as $bumped
  }

  response = { message: $msg }
}
```

**Line count:** ~22.
**Note:** combines the user-message-add AND conversation-bump into one call (matches the pattern in the source file where both happen together). Saves a network hop.
**Failure mode:** retry once. If still 5xx, log to event_log via E7 and continue (don't fail the turn — the message just won't be persisted; reply still goes out).

---

### E4. `get_recent_tech_messages` — POST

**Input:** `int conversation_id, int? limit?` (default 20)
**Output:** `{ messages: [{ role, content, created_at }, ...] }` — chronological (oldest first)

```xanoscript
query get_recent_tech_messages verb=POST {
  api_group = "scheduling"
  input {
    int conversation_id
    int? limit?
  }

  stack {
    var $cap { value = (($input.limit ?? 20)|min:50) }

    db.query agent_message {
      where = $db.agent_message.conversation_id == $input.conversation_id
      sort = {agent_message.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $desc

    var $chrono { value = $desc.items|reverse }
  }

  response = { messages: $chrono }
}
```

**Line count:** ~22.
**Failure mode:** if 5xx, brain treats history as empty (send only the new user turn to Claude). Acceptable for onboarding — first-turn behavior anyway.

---

### E5. `update_tech_fields` — POST

**Input:** `int tech_id` plus the 5 known onboarding-writable fields, all optional:
- `text? preferred_hours_start?`
- `text? preferred_hours_end?`
- `text? daily_summary_time?`
- `text? personal_context?`
- `bool? mark_onboarding_done?` (when true, sets `onboarding_completed_at = now`)

**Output:** `{ ok: true, tech_id, fields_updated: [...] }`

```xanoscript
query update_tech_fields verb=POST {
  api_group = "scheduling"
  input {
    int tech_id
    text? preferred_hours_start?
    text? preferred_hours_end?
    text? daily_summary_time?
    text? personal_context?
    bool? mark_onboarding_done?
  }

  stack {
    var $data { value = {} }
    conditional { if ($input.preferred_hours_start != null) { var.update $data { value = $data|set:"preferred_hours_start":$input.preferred_hours_start } } }
    conditional { if ($input.preferred_hours_end   != null) { var.update $data { value = $data|set:"preferred_hours_end":$input.preferred_hours_end } } }
    conditional { if ($input.daily_summary_time    != null) { var.update $data { value = $data|set:"daily_summary_time":$input.daily_summary_time } } }
    conditional { if ($input.personal_context      != null) { var.update $data { value = $data|set:"personal_context":$input.personal_context } } }
    conditional { if (($input.mark_onboarding_done ?? false) == true) { var.update $data { value = $data|set:"onboarding_completed_at":now } } }

    db.edit technicians {
      field_name = "id"
      field_value = $input.tech_id
      data = $data
    } as $updated
  }

  response = { ok: true, tech_id: $input.tech_id }
}
```

**Line count:** ~32.
**Single endpoint covers 4 of the 5 token side effects:** SET_HOURS (two fields in one call), SET_SUMMARY_TIME, SET_PERSONAL_CONTEXT, ONBOARDING_DONE. ADD_PREFERENCE has its own endpoint (E6).
**Failure mode:** retry once. If still 5xx, log to event_log via E7 and surface to user: `"trouble saving that. try again or text teddy."`.

**XanoScript-syntax risk note:** `data = $data` (variable as data block) MAY not parse — XanoScript may require literal object. Fallback plan: rewrite this endpoint with a conditional `db.edit` per field combination, OR split into 4 sub-endpoints (one per token-type). If the variable-data pattern works it stays single-file; if not, the fallback is uglier but works.

---

### E6. `add_tech_preference` — POST

**Input:** all `tech_preferences` fields explicitly (so Xano runtime gets typed inputs, not a JSON blob):
- `int tech_id`
- `text preference_type`
- `text? zip_or_area?`
- `text? day_of_week?`
- `text? time_window_start?`
- `text? time_window_end?`
- `text strength`
- `text? source?` (defaults to `"explicit"`)
- `text? captured_via_text?`

**Output:** `{ preference: <new row> }`

```xanoscript
query add_tech_preference verb=POST {
  api_group = "scheduling"
  input {
    int tech_id
    text preference_type filters=trim
    text? zip_or_area?
    text? day_of_week?
    text? time_window_start?
    text? time_window_end?
    text strength filters=trim
    text? source?
    text? captured_via_text?
  }

  stack {
    var $src { value = (($input.source ?? "")|first_notempty:"explicit") }

    db.add tech_preferences {
      data = {
        tech_id          : $input.tech_id
        preference_type  : $input.preference_type
        zip_or_area      : $input.zip_or_area
        day_of_week      : $input.day_of_week
        time_window_start: $input.time_window_start
        time_window_end  : $input.time_window_end
        strength         : $input.strength
        source           : $src
        captured_via_text: $input.captured_via_text
        active           : true
      }
    } as $pref
  }

  response = { preference: $pref }
}
```

**Line count:** ~30.
**Failure mode:** retry once. If still 5xx, log to event_log AND continue (other preferences in the same turn still get attempted; user reply still goes out).

---

### E7. `log_event` — POST

**Input:** `text action, text? metadata_json?`
**Output:** `{ ok: true, event_id }`

```xanoscript
query log_event verb=POST {
  api_group = "scheduling"
  input {
    text action filters=trim
    text? metadata_json?
  }

  stack {
    var $meta { value = (($input.metadata_json ?? "{}")|json_decode) }

    db.add event_log {
      data = {
        action  : $input.action
        metadata: $meta
      }
    } as $ev
  }

  response = { ok: true, event_id: $ev.id }
}
```

**Line count:** ~18.
**Used by:** Fix 2 (Claude-error logging), and the brain's general "something went sideways" audit writes.
**Failure mode:** if 5xx, console.error only — never fail the turn over a log write.

---

## Brain module — `_lib/brain/onboarding.js`

Approx 300 lines. Single export: `async function runOnboardingTurn({ phone, body, sid, to })` returning `{ reply: string }`.

### Pseudocode (the per-turn flow)

```
async function runOnboardingTurn({ phone, body, sid, to }) {
  // 1. Look up tech
  const { tech, matched_on } = await crud.getTechByPhone(phone);
  if (!tech) {
    return { reply: "this number isn't recognized as a tech. if you meant to text the company line about service, call 615-280-2949." };
  }

  // 2. Find or create conversation
  const { conversation } = await crud.findOrCreateTechConversation({ tech_id: tech.id, channel: 'sms' });

  // 3. Persist user message (+ bump conversation timestamp; that endpoint does both)
  await crud.addAgentMessage({ conversation_id: conversation.id, role: 'user', content: body });

  // 4. Mode select — onboarding only for this PR; daily-mode techs fall through to the v1 path
  if (tech.onboarding_completed_at) {
    return { reply: null, fallthrough: true };  // signal caller to use v1 path
  }

  // 5. Pull recent messages (history for Claude)
  let history = [];
  try {
    const r = await crud.getRecentTechMessages({ conversation_id: conversation.id, limit: 20 });
    history = r.messages || [];
  } catch (e) {
    console.warn('[brain.onboarding] history fetch failed, sending empty history', e.message);
  }

  // 6. Anthropic call (Fix 2 defensive)
  const claudeMessages = history.map(m => ({ role: m.role, content: m.content }));
  let replyText = '';
  let claudeOk = false;
  try {
    const r = await callAnthropic({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: process.env.ANT_TECH_ONBOARDING_PROMPT,
      messages: claudeMessages,
    });
    if (r.status >= 200 && r.status < 300) {
      const first = (r.body.content || [])[0];
      replyText = (first && first.text) || '';
      claudeOk = true;
    } else {
      // Fix 2: log + canned retry message
      await crud.logEvent({
        action: 'tech_sms_inbound_claude_error',
        metadata: {
          tech_id: tech.id,
          conversation_id: conversation.id,
          status: r.status,
          error_body: r.body,
          user_message_preview: body.slice(0, 200),
          mode: 'onboarding',
        },
      });
      replyText = "hey, signal hiccup on my end. text that again in a sec?";
    }
  } catch (e) {
    console.error('[brain.onboarding] anthropic threw', e.message);
    replyText = "hey, signal hiccup on my end. text that again in a sec?";
  }

  // 7. Token dispatch (in declared order — matches source)
  let cleanReply = replyText;
  if (claudeOk) {
    cleanReply = await applyTokens(cleanReply, replyText, tech.id);
  }

  // 8. Trim + Fix 1 empty-reply guard
  cleanReply = cleanReply.trim();
  if (cleanReply.length === 0) cleanReply = 'got it.';

  // 9. Persist assistant message (+ bump conv via the same endpoint)
  try {
    await crud.addAgentMessage({ conversation_id: conversation.id, role: 'assistant', content: cleanReply });
  } catch (e) {
    console.warn('[brain.onboarding] assistant persist failed; reply still goes out', e.message);
  }

  return { reply: cleanReply };
}
```

### `applyTokens(cleanReply, rawReply, techId)` helper

Token order: SET_HOURS → SET_SUMMARY_TIME → SET_PERSONAL_CONTEXT → ADD_PREFERENCE (multi) → ONBOARDING_DONE.

Implementation: a single pass that finds each paired-token JSON body via string split (same algorithm as the Xano version), runs the corresponding CRUD call, then strips the block from `cleanReply` with regex (or split-and-rejoin for safety). ADD_PREFERENCE uses the Fix-3 multi-block foreach pattern.

For SET_HOURS / SET_SUMMARY_TIME / SET_PERSONAL_CONTEXT / ONBOARDING_DONE → call `crud.updateTechFields(...)` with the appropriate field(s).
For each ADD_PREFERENCE block → call `crud.addTechPreference(...)`.

All four token side-effects can run concurrently except SET_HOURS uses two fields in one update_tech_fields call. The brain calls them sequentially for determinism (matches the source's sequential dispatch).

---

## `tech-sms-inbound.js` modifications

Surgical addition. After the existing `parsed = parse(provider, event)` logic:

```js
const v2Enabled = process.env.TECH_SMS_BRAIN_V2 === 'true';
const v2Phones = (process.env.TECH_SMS_BRAIN_V2_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
const bare = (parsed.from || '').replace(/\D/g, '').slice(-10);
const useBrain = v2Enabled && (v2Phones.length === 0 || v2Phones.includes(bare));

let replyText;
if (useBrain) {
  const { runOnboardingTurn } = require('./_lib/brain/onboarding');
  const r = await runOnboardingTurn(parsed);
  if (r.fallthrough) {
    // Onboarding-complete tech — v2 brain only handles onboarding; defer to v1 for daily mode
    replyText = await fetchAntReply(parsed);
  } else {
    replyText = r.reply || FALLBACK_REPLY;
  }
} else {
  replyText = await fetchAntReply(parsed);
}
```

Everything below this point (TwiML response, Telnyx send_sms hand-off, ack-200) is unchanged.

**Rollback drill:** set `TECH_SMS_BRAIN_V2=false` (or any value other than `"true"`) in Netlify env → next request reverts to old path. No code change needed. Estimated time from problem detection to revert: 30 seconds.

---

## End-to-end failure-mode table

| Failure | Symptom | Brain behavior | User experience |
|---|---|---|---|
| `get_tech_by_phone` 5xx | Network/Xano down | Return canned: "trouble looking you up. text teddy" | User sees the canned message |
| `find_or_create_tech_conversation` 5xx (after 1 retry) | Same | Return canned: "trouble starting our chat" | User sees the canned message |
| `add_agent_message` user-side 5xx (after 1 retry) | Network blip | Log to event_log, continue | User still gets the reply; message just not persisted (Claude history will skip it next turn) |
| `get_recent_tech_messages` 5xx | Same | Treat history as empty, continue | First-turn-like experience; Claude has less context |
| `callAnthropic` non-2xx (Fix 2) | Anthropic 400/429/5xx | Log to event_log, substitute retry-please canned | User sees: "hey, signal hiccup on my end. text that again in a sec?" |
| `callAnthropic` throws (network/timeout) | Anthropic unreachable | Substitute retry-please canned | Same |
| `update_tech_fields` 5xx | Token side-effect failed | Log to event_log, continue token loop | User still gets reply; the field write just didn't happen (next turn Claude may re-ask) |
| `add_tech_preference` 5xx | Same | Same | Same — other preferences in the turn still attempted |
| `log_event` 5xx | Audit log failed | console.error only | No user impact |
| All token dispatch ok but reply empty after strip (Fix 1) | Claude returned only action tokens | Substitute "got it." | User sees "got it." |
| Anthropic returns valid text but no tokens fired | Normal conversational turn | Reply unchanged | User sees Claude's text reply |

---

## Test plan (after build, before T flips the flag for Jimmy)

1. **Unit-fire `runOnboardingTurn` against a test conversation in Node** — feed a synthetic `{ phone, body }` for Jimmy. Verify Anthropic gets called, response parses, `agent_message` rows land in Xano, no crash.
2. **Curl each new Xano endpoint** with valid + invalid inputs. Verify 5 of them write rows; verify response shapes.
3. **Pull each new endpoint after push** (via xano workspace pull) → grep for `db.* ""` to confirm the bug didn't bite the small endpoints. If even one shows corruption: STOP and reassess.
4. **Set `TECH_SMS_BRAIN_V2_PHONES=6159671304`** (Jimmy only) on Netlify staging-like config. Have T text Jimmy a heads-up, then ask Jimmy to text "hey" to the tech number.
5. **Verify in Netlify logs**: `[brain.onboarding]` lines fire, `useBrain=true`, no errors. Verify in Xano `agent_message` table: new rows for Jimmy's conv with non-empty assistant content.
6. **Verify in Xano `event_log`**: any `tech_sms_inbound_claude_error` rows = Anthropic problem; otherwise clean.
7. **If Jimmy's onboarding completes successfully** (`technicians.onboarding_completed_at` set, all 5 preferences captured correctly): blank `TECH_SMS_BRAIN_V2_PHONES` to enable for the other 4 techs.

---

## What we explicitly punt to tomorrow

- Daily-mode brain (9 more tokens, context block builder, owner override logic)
- Migrating the daily-mode path away from the broken Xano endpoint
- Removing or rewriting the old 2142-line `tech_sms_inbound_POST.xs`
- Signature verification on Telnyx webhook
- LA local number routing in send_sms (Phase 2 of original architecture)

When daily mode is built, the feature flag becomes irrelevant and the old Xano endpoint can be deleted.

---

## Risk register

1. **The `data = $data` pattern in E5 may not parse.** Mitigation: prepared fallback (split into per-field-pair endpoints OR rewrite as conditional db.edit blocks). Will be tested in test plan step 3.
2. **`first_notempty` filter may not exist or may have different semantics.** Mitigation: replace with explicit conditional in any endpoint that uses it (E1, E2, E5 source field default).
3. **New endpoints might ALSO hit the Xano serializer bug.** Mitigation: each endpoint is well under 50 lines. Test plan step 3 verifies post-push. If bug fires on even the smallest endpoint, the entire CLI/UI push path is unusable and we escalate to Xano support immediately — no fallback for that scenario.
4. **`ANT_TECH_ONBOARDING_PROMPT` env var.** Verified present on the existing Xano endpoint. Must be ALSO set on Netlify env. T to verify before we test.
5. **Anthropic model `claude-sonnet-4-5-20250929` may have been deprecated.** Behavior should match the existing system exactly; if it 404s during testing, we adopt `claude-sonnet-4-6` (current generation per memory) with a comment that it's a forced upgrade.
6. **Concurrent SMS from the same tech (rapid double-text).** Same race as today — two webhooks land, two agent_messages persist, two Claude calls fire. Acceptable for onboarding rate (techs aren't burst-texting). Not addressing in this PR.

---

## Acceptance criteria for "onboarding mode shipped"

- [ ] All 7 new Xano endpoints deployed and post-push grep shows real table names (zero `db.* "" {`)
- [ ] `_lib/brain/onboarding.js` written, tested in isolation against Xano
- [ ] `tech-sms-inbound.js` feature-flag dispatch in place
- [ ] Jimmy (6159671304) successfully onboards end-to-end with `TECH_SMS_BRAIN_V2_PHONES=6159671304` enabled
- [ ] `technicians.onboarding_completed_at` set for Jimmy
- [ ] Jimmy's preferences (saturday + sunday off from the recovery, plus any new ones from this fresh run) match what he stated in SMS
- [ ] `TECH_SMS_BRAIN_V2_PHONES` blanked → other 4 techs can complete onboarding via the same flow on their next text in

---

## Out of scope for THIS design doc (deferred)

- Daily mode (tomorrow's spec)
- Removing the old endpoint (after daily mode lands)
- Signature verification for Telnyx (deferred to pre-launch hardening per existing doc)
- LA local number routing (Phase 2 of architecture)
- The financial-system endpoints' `else if` + `params=[?]` corruption (separate ticket — same Xano bug class but different module)
