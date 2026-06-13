# 🐜 THE NORTH STAR — Customer self-checkout $50 quick check → TDR → 4 options → auto-everything

Saved 2026-06-13 (Teddy: "this is where it all started"). This is the **next major
goal once the core system is running.** Everything built so far is a piece of this.

## The vision, in Teddy's words
Customer self-checkout. They pay a **$50 quick check**, record a **10-second video
+ a photo of the model number**. The **Teddy Tool is loaded automatically** and
sent to **Teddy + the tech for that zip code**. We give an **honest assessment on
a TDR**, sent back to the customer **within a few hours** — they know exactly what
they're looking at. They get **four options to decide from**. The whole thing is
**completely automated and self auto-scheduled**. Eventually **parts are automated
and shipped to the customer in real time.**

## The end-to-end flow
1. **Self-checkout** — customer pays the $50 quick check online (no phone call).
2. **Capture** — customer records a 10-sec video + photo of the appliance + model #.
3. **Auto-load Teddy Tool** — the media + model + problem populate a diagnostic
   record automatically (no one re-types anything).
4. **Route by zip** — it's sent to Teddy + the right tech for that customer's zip.
5. **Honest TDR back in hours** — Teddy/tech give a real assessment; a customer-
   facing TDR is sent back so the customer understands the problem.
6. **Four options** — customer chooses from the dual-tier matrix:
   OEM vs aftermarket part × DIY (we ship it) vs we-install.
7. **Auto-schedule** — if they pick an install option, it self-schedules onto the
   right tech's day.
8. **Parts shipped in real time** — the part is ordered + shipped automatically
   (to the customer for DIY, or staged for the tech for install).

## What ALREADY exists (this is mostly assembled — it needs orchestration)
- ✅ **$50 quick-check checkout** — Stripe payments live + the `truck.html` funnel
  (currently a booking request; can become pay-first self-checkout).
- ✅ **Media capture** — upload.html / s3 presign → save_attachment (photo + video).
- ✅ **Teddy Tool** — teddy-tdr-tool.html, write-once spine (`update_job_basics`,
  intake → TDR autofill).
- ✅ **Zip → tech routing** — service zones / clusters (check_service_zone,
  TECH_REGION, the scheduling cluster logic).
- ✅ **TDR system** — create_tdr, technician_decision_report, customer-facing
  view (cash-tdr-customer.html).
- ✅ **The 4 options** — the dual-tier model (OEM/aftermarket × DIY-ship/install)
  already lives in the add-on engine + cash-TDR concept.
- ✅ **Auto-schedule** — scheduling_queue + enqueue_scheduling_queue_propose +
  danielle_schedule_parallel_job + APPOINTMENT_SCHEDULED chain.
- ✅ **Payments + tips + tax** — full Stripe loop, vault, customer SMS receipts.
- ✅ **Parts ledger** — parts_orders; ship-only add-on shipping flow.
- 🟡 **Parts automation/real-time ship** — waiting on Marcone/Tribles parts APIs
  (committed, not delivered) to fully automate ordering + ETA + dropship.

## What's NEEDED to make it one automated flow
1. **Self-checkout orchestrator** — pay $50 → create the job/record → prompt the
   capture (video+pic+model) → mark it a "quick check" job.
2. **Auto-load + route** — on capture, populate the Teddy Tool record and notify
   Teddy + the zip's tech (we have the routing + notify pieces; wire them to this
   trigger).
3. **TDR-back-to-customer loop** — when Teddy/tech finish the assessment, push the
   customer-facing TDR + the 4 priced options to the customer (SMS/portal link).
4. **Decision → auto-schedule / auto-ship** — customer picks an option; install →
   auto-schedule, DIY → auto-ship the part (Stripe charge already built).
5. **Parts dropship automation** — once Marcone/Tribles APIs land: real-time
   order + ship + ETA to the customer, no human touch.

## Sequencing
Do NOT start this until the core ops are running clean (HCP fully cut over,
Danielle + techs living in Ant daily). Then this is THE next major arc: stitch
the existing pieces into the one self-serve, auto-scheduled, auto-parts loop.
This is also the seed of the **consumer platform** (snap-a-pic → answer → fix).

## North-star metric
A customer goes from "my fridge is broken" to a scheduled repair with the part on
the way — **paying $50, recording one video, picking one of four options — and no
one at TN Appliance touched a keyboard.**
