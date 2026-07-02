# ✅ To do when Teddy gets home (running list)

Newest at top. Check off + delete once done.

## 2026-07-02

### 🛠️ Two systemic fixes queued (Mac XS + loop — do on the pull)
- **Claim-# dedup on `create_job_from_chat`** — Cynthia Prugh came in twice (AHS dispatch #20088 + web intake #20089, same claim 60322459) because the web intake dedupes on phone/customer but NOT the claim number. Fix: if an incoming web intake carries a claim# already on a job, attach to that job instead of creating a new one. (XS push.) *(The dupe itself is already cleaned — #20089 soft-canceled.)*
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
