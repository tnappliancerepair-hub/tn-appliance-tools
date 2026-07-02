# 🧠 Customer comms — the direction Teddy + Danielle set (2026-07-02)

The single theme behind a dozen issues today: **Ant auto-handles customer texts without understanding the conversation, does nothing useful with them, and hides them from Danielle — so customers get pestered and jobs get missed.**

## What's broken (the pattern, from real threads today)
- Customer replies to a scheduling text → Ant answers "got it, thanks for reaching out" → thread flips to "handled" → drops off Danielle's waiting list → **she never sees the reply → job missed** (this is how Shane's #20025 slipped).
- Ant fires the new-lead setup link + "3 easy steps" scheduling push at people who clearly said "waiting on my tenant" / "call me" / already diagnosed (Jarell, Shane, Kurt).
- Completed/stale jobs keep getting "let's get you scheduled" texts for weeks (Kurt #19475).

## The vision (Teddy's words)
> "When responding to a customer we need to let someone know and try to close the deal. If Ant wanted to schedule the customer he should call the guy working in their area and see what he could do for the customer. He wants the money and the customer wants the help. Why not close the deal and give Danielle the information so she can verify everything is done correctly."

**Ant is the CLOSER, the area tech does the work, Danielle verifies.** Not: Ant nags the customer. Not: Danielle does all the legwork.

## Danielle's add (2026-07-02)
> Remember the human ↔ customer interactions so Ant can respond later with **understanding**. Pay attention to how the customer + the office are responding, and use that context — don't reply context-blind.

**Ant needs conversation memory.** Before it sends anything, it should read the whole thread (customer messages + Danielle's human replies) and understand where things stand. The human replies ARE the memory/examples it learns from. If it doesn't have enough context to help, it stays quiet and flags a human.

## The build (phased)
1. **Stop the harm (shipped 2026-07-02):**
   - A customer reply stays flagged RED in office-messages until a HUMAN replies — AI "got it" no longer clears it; the snippet shows the customer's actual words.
   - Ant's instant reply only fires for a clear fresh repair lead — never courtesy/closing/deferral/matched-job messages.
   - intake-collector stops chasing completed/"needs review"/opted-out customers; 2-text lifetime cap.
   - One-tap "🎄 no coverage" apology + pre-diagnosis, and a "🗂 job tile" jump, in the thread.
2. **Conversation memory (next):** before Ant composes ANY customer reply, feed it the full recent thread INCLUDING Danielle's human replies, so it answers with context (or stays quiet). Per-customer memory so it greets/answers from history, not from scratch. (Data already exists in event_log; the human-vs-AI reply flag already shipped.)
3. **Close-the-deal loop (the autopilot):** when a customer needs scheduling, Ant works the AREA tech (check_service_zone already returns the right tech) — "customer X in your area, open [availability], can you take it?" — locks it, and hands Danielle the finished record to verify. Reuses the smart-routing / tech-offer engine already built (mostly dark today). See docs/self-scheduling-5day-2026-06-28.md.

**Yardstick:** a customer texting us should feel like a person is on it — Ant closes what it can via the tech, and every thread that needs a human is unmistakably in front of Danielle, never silently "handled."
