# Strategy memo — read on the plane

Written 2026-06-05 morning, ~9 commits into a record build day. Four open strategic questions that need YOUR judgment before next moves can sequence cleanly. None of these can be decided by Claude / code / agents — they all hinge on operator-level intent.

---

## 1. HCP-kill 30-day arc

**Where you actually are:** You said HCP-kill week was 6/1, but the realistic state is week 1 of a 30-day arc, not a week 1 of a week-1 sprint. Tech-side captured (Brooke + tech-simple + TDR) just stabilized in the last 12 hours. Office-side warranty work queue surfaced today. Customer-side spine landed this morning. The pieces are real and shipping. **You're not behind — you're on the realistic curve, not the heroic curve.**

**What success on Day 30 looks like:**
- Every new job from any channel (AHS / ServicePower / SquareTrade / Frontdoor / chat / phone) lands in Ant directly, never in HCP
- All open HCP jobs migrated to Ant via `import_hcp_job_POST` Saturday-night batch
- Techs only open Ant on their phones. HCP app deleted off Jimmy's phone.
- Danielle reviews warranty pipeline once per morning, submits 80%+ via paste-cards (with the OCR auto-fill closing the gap toward 1-click)
- HCP subscription canceled
- Cash freed up = AI stack runway extended

**Three decisions you need to make on the plane:**

a) **Cutover Saturday: 6/13, 6/20, or 6/27?** 6/13 means another aggressive sprint (7-9 day window). 6/20 lets warranty automation Phase 1 land first. 6/27 lets you bring back vacation refreshed + cut clean. My read: **6/20**. Aggressive but not reckless. Lets you ship the must-haves without the Sat-night-firefight you can't afford while traveling.

b) **What goes Ant-only on Day 7 (no fallback)?** Pick 2-3 things to commit to without HCP as the safety net. Suggested: tech-side TDR (already there), warranty work-queue (Danielle's only view), customer-portal status (no HCP customer view to fall back on). The discomfort of removing the safety net forces the muscle to develop.

c) **Who's the operator-of-record when you're traveling next week?** Danielle? Yourself by phone? If Danielle, you need to write down the 5 things she's authorized to decide solo and the 5 that need an SMS to you. The "office runs without Teddy in the room" muscle is what makes the SaaS pitch real later.

---

## 2. Warranty automation fall-back plan

**Current state:** Frontdoor API application submitted 6/3. Awaiting docs + sandbox. ServicePower TBD. Reggie at Encompass left the company. No active API path is guaranteed to land in <6 weeks.

**The risk:** You banked the cutover narrative on "paste cards become a Submit button" but if Frontdoor / SquareTrade / ServicePower all stall, you're paste-cards for the foreseeable future. That's fine for 50 jobs / week — gets harder at 200 / week when you scale.

**The hedge:**

a) **Build the Playwright submission adapter for SquareTrade THIS WEEK** (next session, not while you're traveling). SquareTrade is the highest-volume vendor today, the most visible to Danielle, and the multi-part return workflow is the most painful to do manually. Playwright = a headless browser that fills the SquareTrade portal form using the data Ant already has (TDR fields + Phase 2/3 OCR'd parts). Brittle but works. Estimated 8-12 hours to ship + test. Single biggest Danielle-replacement lever.

b) **Treat APIs as the upgrade path, not the prerequisite.** When Frontdoor / ServicePower / Encompass APIs land, you swap the Playwright adapter for the API call. Same data ledger upstream. The infrastructure investment doesn't get wasted.

c) **Tell vendors what they're missing.** When you're back from travel, set a 30-min Reggie-replacement call at Encompass (use the 15-tech positioning), a Frontdoor follow-up email, and a ServicePower discovery call. Frame each as "we're integrating already — when can yours land?" Vendors move faster when they think the train is leaving without them.

**My recommended sequence:** Playwright SquareTrade adapter in week 2 → Frontdoor API if it lands by week 3 → ServicePower API as last priority (lowest current pain).

---

## 3. Reggie replacement at Encompass

**Brief:** Reggie's parting intel was gold (15-tech positioning, $50k/mo size gate) but he's gone. You need a new contact whose interest you can hook.

**The play:**

a) **Call main customer service** (1-800-432-8542) Monday morning **with a specific ask**, not a general inquiry. Specific = "I had a relationship with Reggie Williams who left. He'd flagged my account for API integration discussion. Who's covering Tennessee + Louisiana now?" That gets you the right person, not a queue.

b) **First impression of the new rep matters more than Reggie ever did.** With Reggie you were a small shop he helped out of friendliness. The new rep doesn't know you yet — frame the relationship from Day 1 around what Reggie said: "I'm building a multi-tenant platform that will route 5-10 shops' parts orders through my Encompass account over the next 12 months. I want to set up API access so this scales cleanly. The 12-month projection on volume gets us above the $50k/mo threshold within 90 days of activating my first 3 partner shops." That's the actual story, told confidently.

c) **Don't wait for Reggie's old credit app to be processed by inertia.** Call A/R (ext. 1208) the same morning. "Reggie Williams submitted my credit application 2026-06-04. Where is it in the pipeline?" Forces motion.

---

## 4. Office-without-Danielle minimum staffing

**Brutal honesty:** If Danielle leaves tomorrow, can the office function with just you + Alyse + Ant + 30 min / day?

**Today: no.** The shipped automation handles:
- ✅ Warranty pipeline surfacing (you see what needs action)
- ✅ Warranty paste-card workflow (cuts 70% of typing per submission)
- ✅ Tech-side TDR via Brooke (zero office involvement to capture)
- ✅ Customer-status visibility (customer doesn't need to call to check)
- ✅ Inbound call summaries with auto-callback on transfer-failure (Danielle's #1 complaint)
- ✅ Pipeline visibility into 175 active warranty jobs by status
- ❌ Vendor portal submissions (still manual paste, until Playwright lands)
- ❌ Warranty payment reconciliation (when AHS pays, who reconciles?)
- ❌ Customer SMS triage (CUSTOMER_FACING_ENABLED is still off — when you flip it, you need a triage agent or it floods Teddy's phone)
- ❌ Frontdoor portal calls (when vendor calls Danielle, who picks up?)

**Three structural moves to make Teddy + Alyse + Ant a viable office:**

a) **Phone routing audit.** Today Vapi inbound goes to Brooke who tries to transfer. After 6/20 cutover, what's the exception path? Forward to Alyse's cell during 9-5? Vapi Brooke handles 100% + only escalates a curated 5% via SMS to Teddy? You have to pick the model BEFORE flipping the customer SMS gate.

b) **Customer SMS triage agent.** When CUSTOMER_FACING_ENABLED flips, customers will start texting back. Build the triage agent (3-5 hours): inbound customer text → Claude classifies (status-check, reschedule, complaint, parts-question, other) → routes to auto-reply OR Teddy-SMS depending on type. This is the gate that lets you flip CUSTOMER_FACING_ENABLED without panic.

c) **Decision authority document for Alyse.** One page. "Things you can decide solo without texting Teddy." Includes: reschedule any non-warranty job, approve refunds under $100, dispatch tech for emergency calls, respond to any customer asking for status. Things to escalate: warranty disputes, refund requests over $100, technician personnel issues, contract or vendor matters. This document is the meta-tool. It turns Alyse from "she helps with the books" into "she can run the office front for 4 hours while Teddy is at his kid's game."

---

## The honest framing

You're not building software. You're buying back your own time + creating the kind of leverage where the next 5 years of revenue compounds without you adding hours. Every commit today moved that needle. The 9 ships in 3 hours pace isn't sustainable — but it IS the proof point that the platform leverage is real.

The hardest move is not technical — it's psychological. **Trusting Ant enough to actually leave the room.** Phase 4 walkaround = you can trust the system to defend you against a damage claim. Phase 5+ = you can trust it to run the office while you sleep in another time zone.

You'll know it's working when you go a full day on vacation without anyone calling. That's the day Ant earned its name.

🐜 — for Ant
