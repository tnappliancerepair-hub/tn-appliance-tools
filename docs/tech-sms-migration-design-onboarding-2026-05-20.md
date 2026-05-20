# tech_sms_inbound migration — onboarding-mode design (REVISED)

**Status:** Approved, pivoted to Metadata API direct.
**Revised:** 2026-05-20 (afternoon)
**Original:** `docs/tech-sms-migration-design-onboarding-2026-05-20-original.md` (preserved for audit trail)
**Trigger for revision:** the small-Xano-endpoint approach hit the unresolved-references corruption documented in `docs/xano-deploy-corruption-explained-2026-05-20.md`. Canary endpoint E7 (log_event, 18 lines) failed to even deploy. Pivoted to Metadata API direct.

---

## Architecture summary

```
Telnyx / Twilio webhook
   │
   ▼
netlify/functions/tech-sms-inbound.js    (existing thin proxy, modified — feature-flag dispatch)
   │
   ▼  (when TECH_SMS_BRAIN_V2 == "true" && phone in TECH_SMS_BRAIN_V2_PHONES)
netlify/functions/_lib/brain/onboarding.js   (NEW — the brain)
   │
   ├─► fetch Anthropic   (https://api.anthropic.com/v1/messages, env ANTHROPIC_API_KEY)
   └─► require('../xano/metadata-crud')   (NEW — wrappers around Xano Metadata API)
            │
            └─► HTTPS to xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/{id}/...
                using XANO_METADATA_TOKEN bearer
                directly against the 5 tables (technicians, agent_conversation,
                agent_message, tech_preferences, event_log)
```

**The key change:** NO new Xano endpoints. All DB ops go through Xano's Metadata API (`/api:meta/workspace/{id}/table/{id}/content`). This bypasses the XanoScript import resolver entirely — no risk of unresolved-reference corruption, no XanoScript deploys required.

Old path stays available for instant rollback:
```
   │  (when flag off or phone not in allowlist — default)
   ▼
Xano tech_sms_inbound   (the broken 2142-line file — fallback for unaffected daily-mode techs)
```

---

## Routing strategy — recommended (unchanged from original)

**Feature flag inside `tech-sms-inbound.js`.** New env var `TECH_SMS_BRAIN_V2` on Netlify. Set to `"true"`. Restrict initial rollout to Jimmy only via `TECH_SMS_BRAIN_V2_PHONES=6159671304`. Instant rollback by flipping `TECH_SMS_BRAIN_V2=false`.

```js
const v2Enabled = process.env.TECH_SMS_BRAIN_V2 === 'true';
const v2Phones = (process.env.TECH_SMS_BRAIN_V2_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
const bare = (parsed.from || '').replace(/\D/g, '').slice(-10);
const useBrain = v2Enabled && (v2Phones.length === 0 || v2Phones.includes(bare));
```

---

## File layout

```
netlify/functions/
├── tech-sms-inbound.js                (modified — adds feature-flag dispatch)
└── _lib/
    ├── brain/
    │   └── onboarding.js              (NEW — the brain; exports runOnboardingTurn)
    └── xano/
        └── metadata-crud.js           (NEW — wrappers around Xano Metadata API)
```

Notes:
- No `tech-sms-inbound-v2.js` Netlify function. Original design had this as an optional parallel webhook entrypoint; the feature flag inside the existing file is sufficient and avoids managing two webhook URLs.
- `_lib/` directory is underscore-prefixed → Netlify function-discovery skips it. Modules live here without becoming their own webhook URLs.

---

## Metadata API surface (the only Xano dependency)

Auth: `Authorization: Bearer ${XANO_METADATA_TOKEN}` on every call. Token sourced from `~/.xano/credentials.yaml` user token for today's emergency build. **Cleanup item:** rotate to a scoped Metadata API key in Xano, set as separate env, swap in. Tracking under "production hardening" — not blocking shipping today.

| Operation | HTTP | Path | Notes |
|---|---|---|---|
| List rows | GET | `/api:meta/workspace/1/table/{id}/content?per_page=N&page=N` | All rows (paged). Used as fallback when search not needed. |
| Read one | GET | `/api:meta/workspace/1/table/{id}/content/{row_id}` | Single row by primary key. |
| Search | POST | `/api:meta/workspace/1/table/{id}/content/search` | Body: `{search:{field:value, ...}, sort:{field:"desc"|"asc"}, per_page, page}`. **`search` key must wrap the filter object**, otherwise filter is silently ignored (returns all rows). |
| Insert | POST | `/api:meta/workspace/1/table/{id}/content` | Body: full row object. Returns inserted row with id. |
| Update | PUT | `/api:meta/workspace/1/table/{id}/content/{row_id}` | Body: partial row object. PATCH semantics (unset fields are preserved). |
| Delete | DELETE | `/api:meta/workspace/1/table/{id}/content/{row_id}` | Returns 200 with null body on success, 404 if not found. |

All shapes confirmed by direct probe today (2026-05-20). All examples in `docs/xano-deploy-corruption-explained-2026-05-20.md`.

### Table IDs

| Table | ID |
|---|---|
| `event_log` | 3 |
| `agent_conversation` | 4 |
| `agent_message` | 5 |
| `technicians` | 15 |
| `tech_preferences` | 27 |

---

## Module A — `_lib/xano/metadata-crud.js`

Approximately 200 lines. Seven helper functions matching the original endpoint design's logical surface, but implemented as direct Metadata API calls instead of new Xano endpoints.

```js
// Pseudo-shape (full impl in Build A):

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TABLES = {
  event_log: 3,
  agent_conversation: 4,
  agent_message: 5,
  technicians: 15,
  tech_preferences: 27,
};

function auth() {
  return { 'Authorization': `Bearer ${process.env.XANO_METADATA_TOKEN}`, 'Content-Type': 'application/json' };
}

async function getTechByPhone(phone) {
  // 1. Try exact match
  const exact = await search(TABLES.technicians, { phone });
  if (exact.length) return exact[0];
  // 2. Try last-10-digit bare form
  const bare = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!bare) return null;
  const fallback = await search(TABLES.technicians, { phone: bare });
  return fallback[0] || null;
}

async function findOrCreateTechConversation(techId, channel = 'sms') {
  // Try latest by (tech_id + channel)
  const existing = await searchOne(TABLES.agent_conversation,
    { tech_id: techId, channel },
    { created_at: 'desc' });
  if (existing) return existing;
  // Create
  const sessionId = `tech_${techId}_${Date.now()}`;
  return await insert(TABLES.agent_conversation, {
    tech_id: techId, channel, title: 'Tech SMS',
    last_message_at: Date.now(), session_id: sessionId,
  });
}

async function addAgentMessage(conversationId, role, content) {
  const msg = await insert(TABLES.agent_message, {
    conversation_id: conversationId, role, content,
  });
  // Bump conversation's last_message_at — fire-and-forget; don't block return on it
  update(TABLES.agent_conversation, conversationId, { last_message_at: Date.now() }).catch(() => {});
  return msg;
}

async function getRecentTechMessages(conversationId, limit = 20) {
  const desc = await searchPage(TABLES.agent_message,
    { conversation_id: conversationId },
    { created_at: 'desc' }, limit);
  return desc.reverse();   // chronological for Anthropic
}

async function updateTechFields(techId, fields) {
  // fields: subset of {preferred_hours_start, preferred_hours_end, daily_summary_time, personal_context, onboarding_completed_at}
  return await update(TABLES.technicians, techId, fields);
}

async function addTechPreference(prefObject) {
  return await insert(TABLES.tech_preferences, { active: true, source: 'explicit', ...prefObject });
}

async function logEvent(action, metadata) {
  try {
    return await insert(TABLES.event_log, { action, metadata });
  } catch (e) {
    console.error('[metadata-crud] logEvent failed', e.message);
    // never throw — audit failures must not break the caller
    return null;
  }
}
```

Internal helpers `search()`, `searchOne()`, `searchPage()`, `insert()`, `update()` wrap fetch + auth + JSON + error handling. Each retries once on 5xx with 500ms backoff; on persistent failure throws an error tagged `{ status, body }` so the brain can decide per-operation handling.

---

## Module B — `_lib/brain/onboarding.js`

Approximately 250 lines. Single export: `async function runOnboardingTurn({ phone, body, sid, to })` returning `{ reply: string, fallthrough?: boolean }`.

Behavior matches the original `tech_sms_inbound_POST.xs` onboarding branch exactly (per `docs/tech-sms-migration-inventory-onboarding-2026-05-20.md`). Pseudocode unchanged from the original design doc; just substitute `metadata-crud` for the originally-planned `scheduling-crud`.

Includes:
- Fix 1 (empty-reply guard → "got it.")
- Fix 2 (defensive Anthropic response access + `event_log` Claude-error row when non-2xx)
- Fix 3 (multi-block ADD_PREFERENCE iteration)

---

## Module C — `tech-sms-inbound.js` (modified)

Surgical addition right before the existing `fetchAntReply(parsed)` call:

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
    replyText = await fetchAntReply(parsed);
  } else {
    replyText = r.reply || FALLBACK_REPLY;
  }
} else {
  replyText = await fetchAntReply(parsed);
}
```

Everything else (TwiML response, Telnyx send_sms hand-off, ack-200) is unchanged.

---

## End-to-end failure-mode table (updated for Metadata API)

| Failure | Brain behavior | User experience |
|---|---|---|
| `getTechByPhone` 5xx (after 1 retry) | Return canned: "trouble looking you up. text teddy" | User sees canned message |
| `findOrCreateTechConversation` 5xx | Return canned: "trouble starting our chat" | User sees canned message |
| `addAgentMessage` user-side 5xx | Log to event_log, continue | Reply still goes out; message just not persisted |
| `getRecentTechMessages` 5xx | Treat history as empty, continue | First-turn-like context for Claude |
| `callAnthropic` non-2xx (Fix 2) | Log Claude error to event_log, substitute retry canned | User sees "hey, signal hiccup on my end. text that again in a sec?" |
| `callAnthropic` throws | Substitute retry canned | Same |
| `updateTechFields` 5xx | Log to event_log, continue token loop | Reply still goes out; field write missed |
| `addTechPreference` 5xx | Log to event_log, continue | Reply still goes out; other preferences in turn still attempted |
| `logEvent` 5xx | console.error only | No user impact |
| Empty reply after token strip (Fix 1) | Substitute "got it." | User sees "got it." |
| Anthropic 200 but no tokens fired | Reply unchanged | User sees Claude's text reply |

---

## Test plan (after build, before T flips the flag for Jimmy)

1. **Local Node smoke** — invoke `runOnboardingTurn` with mock `{ phone: '+16159671304', body: 'hi' }` (test conversation). Verify Anthropic gets called, response parses, agent_message rows land, no crash.
2. **Set env vars on Netlify staging-like config** — see Build D.
3. **Curl the deployed Netlify function** with Jimmy's phone + body 'hi':
   - Twilio-shape body (form-encoded), to verify provider parsing
   - Verify response is TwiML with the reply text
4. **Inspect Metadata API**:
   - `POST /content/search` on agent_conversation with `{tech_id: 2, channel: "sms"}` — confirm new or existing conversation row
   - `POST /content/search` on agent_message with `{conversation_id: <X>}` — confirm user message persisted, assistant message persisted, NON-EMPTY content
5. **Inspect Netlify function logs** — verify `[brain.onboarding]` lines fire, `useBrain=true`, no errors
6. **If clean** — show T the full request/response trace. T messages Jimmy after approving.

---

## Risk register (updated)

1. **`XANO_METADATA_TOKEN` is a user-scoped token.** Has broad workspace permissions. Acceptable for emergency build. Cleanup: rotate to a Metadata API key with `workspace:content:*` scope only.
2. **`ANT_TECH_ONBOARDING_PROMPT` env var.** Currently set in Xano. Must be ALSO set on Netlify. Build D handles this — dump from Xano, set on Netlify via Netlify Personal Access Token.
3. **Anthropic model `claude-sonnet-4-5-20250929`.** Per user direction, keeping exact model match for behavior parity.
4. **agent_message could grow large.** itemsTotal was ~40k earlier today. Search is server-side filtered + paged, so per-turn cost stays O(20 messages) regardless of total table size.
5. **Concurrent SMS from the same tech.** Same race as today — two webhooks, two agent_messages, two Claude calls. Accepted for onboarding.
6. **Metadata API rate limits.** Unknown. If we hit them under normal traffic the brain degrades to retries-then-fail; user sees retry canned. Watch event_log for patterns post-launch.
7. **Old Xano `tech_sms_inbound` endpoint still broken.** Daily-mode techs (none today — all 5 are still onboarding) would hit `dbo` error. Since `TECH_SMS_BRAIN_V2_PHONES=6159671304` restricts to Jimmy and the brain checks `tech.onboarding_completed_at`, this is theoretical for today.

---

## Acceptance criteria

- [ ] Jimmy (phone 6159671304) successfully completes onboarding via the new brain
- [ ] `technicians.onboarding_completed_at` set for Jimmy
- [ ] Jimmy's preferences (including saturday + sunday off, plus any new ones from this fresh run) match what he stated in SMS
- [ ] Conversation history in agent_message has alternating user/assistant rows, no empty content
- [ ] Zero entries in event_log with action="tech_sms_inbound_claude_error" for Jimmy's session (or, if any, they're recoverable)
- [ ] After Jimmy onboards successfully, blank `TECH_SMS_BRAIN_V2_PHONES` to enable for the other 4 techs

---

## What's deferred to tomorrow

- Daily-mode brain (9 more tokens, context block builder, owner override logic)
- Rotating `XANO_METADATA_TOKEN` to a scoped key
- Removing the old broken `tech_sms_inbound_POST.xs`
- Signature verification on Telnyx webhook
- LA local number routing in send_sms (Phase 2 of original architecture)

---

## Comparison: this design vs the original

| Aspect | Original (Xano endpoints) | Revised (Metadata API direct) |
|---|---|---|
| New Xano endpoints | 7 small (each <50 lines) | 0 |
| Risk of unresolved-references corruption | HIGH (proven during canary) | NONE (bypasses XanoScript import) |
| Netlify modules | 2 (`_lib/brain/onboarding.js`, `_lib/xano/scheduling-crud.js`) | 2 (`_lib/brain/onboarding.js`, `_lib/xano/metadata-crud.js`) |
| Auth model | Public Xano endpoints (no auth) | Bearer token (XANO_METADATA_TOKEN) on every DB call |
| Deploy complexity | High (CLI push 7 endpoints + verify each) | Low (just `git push` Netlify) |
| Rollback | Flip feature flag | Flip feature flag |
| Test surface | Per-endpoint smoke + full integration | Full integration only (no per-endpoint test) |
| End-to-end identical behavior to source XanoScript | YES | YES |
