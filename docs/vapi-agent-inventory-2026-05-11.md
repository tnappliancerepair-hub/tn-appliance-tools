Vapi agent inventory captured 2026-05-11 morning chat session. Complete enumeration of all 15 agents in the Vapi dashboard at the time of inventory. Companion to docs/system-blueprint-decisions-2026-05-09.md Decision 2 (Ant Status Update agent — existing vs new). Resolves Decision 2: status delivery pattern confirmed across multiple specialist agents; build new specialist agents for new triggers rather than one consolidated branching agent.


Vapi Agent Inventory — 2026-05-11
Summary
15 agents total in Vapi dashboard. 11 Ant agents (TN Appliance Exchange brand, Heisenberg voice, Anthony tribute language, single-purpose specialist pattern). 4 developer-built James Repair agents (Sarah voice, different tool stack, multi-purpose with internal branching, deployed in dev/qa/prod environment variants — 2 unique agents in 2 environments each).
The two stacks are NOT currently wired together. Integration deferred to Week 2+.
Ant Agents (11 total — your platform)

Ant Warranty Fallback — OUTBOUND. 2hr warranty intake fallback when customer didn't fill out form. Calls customer, collects appliance details verbally, texts Appliance Ant chat link, captures scheduling preference. Variable context: YES (customer_name, warranty_provider, appliance_type, service_address, appliance_brand).
Ant Inbound — INBOUND. Main receptionist replacement. Handles warranty + self-pay + existing customers + dispatch updates + upsells + warranty company callbacks. Bridges to Appliance Ant chat. Variable context: YES via tools (get_job_by_phone, get_parts_status, book_appointment, send_payment_link).
Ant Parts Follow-Up — OUTBOUND. Parts arrived → offer 3 slots → book installation appointment. 3-min target. Variable context: YES (customer zip code, job_id, technician name). Tools: get_available_slots, book_appointment.
Ant Appointment Reminder — OUTBOUND. Day-before reminder + home confirmation + access info collection (gate code, dog, etc). 2-min target. No voicemail; SMS fallback if no answer. Variable context: YES (customer_name).
Ant Missed Call Callback — OUTBOUND. Sub-2-min return call after missed inbound. Branches on warranty/self-pay/question/wrong number. Mirrors Ant Inbound's logic. Variable context: YES (customer_name with graceful fallback if unknown).
Ant Authorization Update — OUTBOUND. Warranty auth status delivery (approved/denied/pending). SPECIALIST STATUS DELIVERY PATTERN. Variable context: YES (customer_name, authorization_status, appliance_type, job_id).
Ant Parts ETA Update — OUTBOUND. Parts ordered + ETA delivery. SPECIALIST STATUS DELIVERY PATTERN. Variable context: YES (customer_name, appliance_type, parts_eta, job_id).
Ant Tech Running Late — OUTBOUND. Late ETA notification + reschedule offer. 90-sec target. SPECIALIST STATUS DELIVERY PATTERN. Variable context: YES (customer_name, appliance_type, tech_name, new_eta, job_id).
Ant Reschedule — HYBRID (inbound + outbound). Reschedule appointments from either direction. Variable context: YES (customer_name, appliance_type, current_appointment, job_id). Tools: get_job_by_phone, get_available_slots, book_appointment.
Ant After Hours — INBOUND. Off-hours reception + urgency triage (safety risk / major inconvenience / non-urgent). Genuine safety triage built in for gas leaks, flooding, electrical hazards. Variable context: NO explicit runtime variables — uses tools (get_job_by_phone, book_appointment) for lookups.
Ant Warranty Company Inbound — INBOUND B2B. Warranty company calls (AHS, SquareTrade, Frontdoor, ServicePower). Five paths: status, authorize, deny, new job assignment, parts inquiry. Audit trail to event_log. Distinct professional tone vs warm consumer agents. Variable context: NO explicit runtime variables — inbound only, looks up via tools.

Developer Agents (4 total — James Repair branding, not wired in)

James Repair Multi-Purpose INBOUND (QA env) — qa_ prefix tools. 3-in-1 inbound: job status + parts + new service scheduling. Strict validation. Tools: qa_lookup_warranty_status, qa_propose_schedule, qa_confirm_schedule, parts_lookup.
James Repair Multi-Purpose INBOUND (DEV env) — dev_/no-prefix tools. Dev environment variant of #12. Tools: lookup_warranty_status, propose_schedule, confirm_schedule, dev_parts_lookup.
James Repair Outbound Notify (QA env) — qa_ prefix tools. Two-flow: job_completed | parts_arrived_reschedule. Runtime variables, status enum branching. Tools: qa_reschedule_proposal, qa_confirm_reschedule_proposal.
James Repair Outbound Notify (PROD env) — no prefix tools. Production variant of #14. Tools: reschedule_proposal, confirm_reschedule_proposal.

Developer agent characteristics:

Brand: James Repair (NOT TN Appliance Exchange / Ant)
Voice: Sarah (NOT Heisenberg)
Transcriber: Deepgram Flux (NOT Nova 2 Phonecall)
Tools: lookup_warranty_status, propose_schedule, confirm_schedule, parts_lookup, reschedule_proposal, confirm_reschedule_proposal (none of these exist in TN Appliance Xano workspace)
Design pattern: multi-purpose with internal status branching (different from Ant's specialist pattern)
Environment separation: dev/qa/prod siblings (Ant agents have no environment separation today)
Service area framing: Nashville + New Orleans (different from Ant's "Middle Tennessee + Louisiana")
No Anthony reference, no "pronounced like the insect" rule, no neighborly tone

Architectural Patterns Identified
Pattern 1 — Ant Specialist Status Delivery (3 confirmed instances)
Agents 6 (Authorization Update), 7 (Parts ETA Update), and 8 (Tech Running Late) all follow the same architectural shape:

RUNTIME VARIABLES — customer_name, appliance_type, status-specific variables, job_id
CALL OPENING — confirm name, identify business, ask for second
MAIN MESSAGE — single status delivery, optionally with conditional response branches
IF YES / IF NO / IF edge case — branches
NO ANSWER VOICEMAIL — trigger-specific copy
SILENCE HANDLING — universal 5s + 5s pattern
WRAP UP — warm closing
TOOLS — minimal (get_job_by_phone, sometimes book_appointment)

This IS the "Ant Status Update" pattern. New status delivery agents follow this template.
Pattern 2 — Developer Multi-Purpose Branching (1 instance, 2 environments)
Developer agents 14/15 use one outbound agent that branches internally on status enum value. Different architectural choice — fewer agents to manage but one bigger prompt.
Pattern 3 — Brand Voice Consistency
All 11 Ant agents share:

Pronunciation rule ("pronounced like the insect ant, rhymes with can't, NOT aunt")
Warm neighborly tone
TN Appliance Exchange business name
Philosophy B operationally encoded (weekdays only, mutual respect framework, honest timeline)
Anthony tribute via naming and tone
Heisenberg voice via 11Labs
Nova 2 Phonecall transcriber (developer agents use Deepgram Flux instead)

Minor consistency drift: pronunciation rule phrasing varies slightly across agents ("rhymes with can't" vs "rhymes with aunt but pronounced like the insect"). Both correct but worth standardizing in a future polish pass.
Decision 2 Resolution
Question: For voice-only customer transparency (customers who chose "Call me only" on the consent gate), does an existing Vapi agent serve as the "Ant Status Update" agent, or do we build new?
Answer: Build new specialist agents matching Pattern 1 (specialist status delivery). Reasoning:

Existing 11 Ant agents are all specialists for specific scenarios — none is a generic "Ant Status Update" agent
The Pattern 1 template is well-established (3 instances already in production)
Adding 4 new agents matching the pattern is consistent with the existing platform design
Each new agent ~30-60 min prompt authoring effort
Alternative (one consolidated branching agent) would break the existing pattern and create a maintenance liability

4 new agents to build (Week 1 Day 2 work):

Ant Teddy Review Started — fires when Teddy opens QC cockpit (jobs.teddy_review_started_at trigger)
Ant Parts Ordered — fires when customer picks Install OEM/Amazon (could overlap with existing Ant Parts ETA Update — consider whether to extend or build new)
Ant Parts Shipped — fires when shipment confirms with tracking info
Ant Parts Delivered — fires when customer texts DELIVERED keyword (DIY vs Install branch)

Each new agent: 30-60 min prompt authoring. Total: 2-4 hours of Vapi dashboard work. Plus orchestration logic in Xano endpoints to fire the right agent at each trigger.
Developer vs Ant Integration Gap
The 4 developer-built James Repair agents are NOT wired in. They exist in the Vapi dashboard alongside the Ant agents but no Xano endpoints call them.
Key architectural conflict if both were ever to go live in production simultaneously:

Different brand identity (James Repair vs TN Appliance Exchange)
Different voice (Sarah vs Heisenberg) — customer would experience brand whiplash
Different tool backend (qa_/lookup_/propose_* don't map to existing Xano endpoints)
Different design pattern (multi-purpose branching vs specialist)
No clear integration plan documented

Three resolution paths to consider in Week 2+:

Rebrand and merge — bring developer agents under Ant identity. Heisenberg voice, Anthony tribute language, TN Appliance branding. Use their tool backend or migrate to Ant's.
Keep separate — developer agents serve a different operational scope (a separate licensee? a future feature?). Document clearly so they never accidentally activate against TN Appliance customers.
Replace some Ant agents — if developer architecture is genuinely better (their validation rigor is, in some areas), replace specific Ant agents with developer-built equivalents. Highest-risk path.

Recommendation: This is a Week 2+ conversation, not today. Focus Day 2 work on building the 4 new Ant Status agents per Decision 2 resolution. Developer integration deferred until evidence-based decision can be made.
Status
Vapi inventory captured and committed for cross-session durability. Decision 2 resolved: build new specialist agents matching Pattern 1. Developer vs Ant integration gap flagged for Week 2+ architectural conversation.
