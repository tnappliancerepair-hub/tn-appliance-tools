# Andre Onboarding Recovery — 2026-05-20

## Why this file exists

On 2026-05-20 during the tech SMS v2 brain rollout, a bug in
`metadata-crud.js#findOrCreateTechConversation()` caused Andre's
inbound messages to be persisted into Jimmy's conversation
(`agent_conversation.id=673`) instead of a new conversation for Andre.

Root cause: Xano Metadata API's `{search: {...}}` parameter does not
enforce strict structured filtering on multi-field queries. The helper
function silently received the wrong row (Jimmy's conv 673) when
searching for Andre's conv with `{tech_id: 3, channel: "sms"}`.

Andre's TECH RECORD (`technicians.id=3`) was correctly updated by token
dispatch (which uses `tech.id` directly, not via conv lookup). His
`onboarding_completed_at` was set, but his actual schedule data
(`preferred_hours_*`, `daily_summary_time`, `personal_context`) was NOT
populated because Ant — reading Jimmy's conv 673 as Andre's history —
thought hours/summary/context were already done.

His tech_preferences also has a junk row (id=14, day="") emitted from
Jimmy's load-me-up-on-no-daughter-weeks context.

When Andre is properly re-onboarded after the bug is fixed, use the
substantive answers below to short-circuit the questions he already
answered.

## Andre's identity

- `technicians.id` = 3
- name: Andre
- phone: `+16159693115` (stored as `6159693115` bare-10-digit)

## Andre's verbatim answers captured during the polluted flow

All timestamps UTC, source: `agent_message` rows in conv 673 (now deleted).

### `agent_message.id=3822` @ 20:31:47

> Hey

(Andre's reply to T's kickoff text. Conversation opener — no content.)

### `agent_message.id=3824` @ 20:32:21

> I want at least 6 to 7 jobs Monday through Friday

### `agent_message.id=3826` @ 20:32:57

> Around 8 to 5 and then if I have any free time after I get done with
> any more jobs, I would like to add more if I could

### `agent_message.id=3828` @ 20:33:19

> Yes

(Confirming Ant's clarifying question: *"youre saying if you finish your
scheduled jobs early, you want more work added same-day to fill the time?"*)

## Parsed preferences

| Field | Value |
|---|---|
| Hours | 8am – 5pm (approximately) |
| Daily job target | 6–7 jobs minimum Mon–Fri |
| Load behavior | "Load-me-up" type — wants additional same-day jobs added if he finishes early |
| Days off | Not stated (Ant skipped the question because Jimmy's history showed sat/sun off, which is not Andre's preference) |
| Daily summary time | Not stated (skipped) |
| Personal context | Not stated (skipped) |

## Recommended recovery action

When the multi-field-search bug is fixed in `metadata-crud.js`:

1. Reset Andre's `onboarding_completed_at` back to `null` (so the brain
   re-enters onboarding mode for him).
2. Delete the junk `tech_preferences.id=14` row (day="" / strength="soft").
3. Have T text Andre something like: *"hey andre, had a system mixup. let
   me re-do your setup real quick. you said 6-7 jobs mon-fri, 8 to 5,
   load you up if you finish early — confirm? also need to know any
   standing days off."*
4. Brain will pick up from a clean conv, capture his days-off + any other
   context, then complete onboarding properly with hours/summary/context
   populated.
