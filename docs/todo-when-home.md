# ✅ To do when Teddy gets home (running list)

Newest at top. Check off + delete once done.

## 2026-07-02

### 📱 Pull SquareTrade customer phones from the ST portal (biggest warranty-reach unlock)
294 of 327 SquareTrade needs-scheduled jobs have NO phone in Ant — dispatch emails carry only the claim#, phones live in the ST portal. Can't text ~290 warranty customers for pre-diagnosis/availability without them. Automate pulling phones from the ST portal → they flow into the intake ask. (AHS jobs all have phones; this is ST-specific.)

### 🛠️ Systemic "don't duplicate — match & attach" fix (Mac XS + loop — do on the pull)
The #1 recurring problem all day. Intake/new-lead matches ONLY on phone, so it creates duplicate (often mis-labeled CASH) tickets for people who are already in the system. Teddy's rule: **on a no-match, DON'T auto-create a ticket — collect the info, match it, and if it pulls up, ADD them to the existing job. Only make a new ticket if truly new.**
- **Claim-# dedup on `create_job_from_chat`** — Cynthia Prugh: AHS dispatch #20088 + web intake #20089, same claim 60322459. Fix: incoming claim# already on a job → attach, don't create. *(Dupe cleaned — #20089 soft-canceled.)*
- **Household / alt-contact matching** — Ashley Bordelon texted about the oven; the warranty job is under her wife **Toby Dennis**; different phone → AI made a 2nd CASH claim for Ashley. Fix: before creating, match on **address + name + claim#**, not just phone. On a match, link the person as an alternate contact on the existing job (use the existing `related_customer_id` / add-phone), inherit warranty, and route their future texts to that job. Don't auto-label cash on a no-match — collect address/claim first, then match. *(Immediate Ashley↔Toby merge: pending — Claude can link/cancel the dup on request.)*
- **When the agent can't find them, ASK whose it's under (both Vapi phone + SMS)** — instead of creating a new ticket: *"I don't see you in our system yet — it may be under a family member. Whose name is the account under — a spouse, parent, or sibling? Or what phone number is it under? — so I can find you."* Then look up by that name/number and attach. This is a Vapi Ant Inbound prompt block + the SMS new-lead flow. (Vapi = prompt change via vapi-admin; SMS = the loop/intake matching above.)
- Ties into the conversation-memory + close-the-deal direction. See `docs/customer-comms-direction-2026-07-02.md`.
- **Conversation memory for Ant's replies** — before Ant sends ANY customer text, feed it the full thread INCLUDING Danielle's human replies (via `get_sms_thread_for_job`), so it answers with context or stays quiet. The human-vs-AI reply flag shipped today is the signal it reads. This is the "remember the conversation" ask + the close-the-deal-via-tech loop. See `docs/customer-comms-direction-2026-07-02.md`. (Loop build — deploys on the pull.)

### 🖥️ Run the Mac Mini pull + loop restart (needs you at the Mac) — TOP
Restores the **missed-call auto-callback safety net** (fired 0× today — dropped calls like Shannon Hill got no automatic ring-back) AND activates the loop-side half of the SMS auto-reply fix (stop the AI replying to "thank you"/closing texts + hiding threads).
```
cd ~/tn-appliance-tools && git pull origin main && launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop
```
Then confirm: `pgrep -fl colony-loop` = one PID, and heartbeat is fresh.

### 📞 Call back the 2 dropped callers from this morning
- **Shannon Hill — 615-400-9686** (9:38a) — Ant couldn't match her to an account (no claim # on file), call timed out, no callback captured.
- **615-602-6260** (9:48a) — confused by the AI, hung up at 14s.

### 📋 Work the callback queue (now surfaced in office Messages)
13 open callbacks were sitting unworked in `callbacks.html` — now shown as a red "📞 N callbacks to work" banner at the top of **office-messages**. Clear them. **William Tiefenbrun (720-999-3586)** is in there — his part arrived (dispatch 56649059), he's ready for install → schedule Lee.

### 🗂️ Parts-resale kickoff (Amazon seller account is live + healthy)
- Grab the **storage-unit Google Sheet** from Danielle → send to Claude for the brand-gating breakdown + FBA pick-list.
- Set Danielle up with a **limited Seller login** (inventory/listings/FBA only — no banking/tax).
