# Cybertruck rolling-ad concept — TN Appliance / Ant

Saved 2026-06-13. Teddy's idea: run ads on his Cybertruck (digital LED side-screen,
like the rolling billboards already out there). Develop into a measurable lead
channel that funnels straight into the Ant system, and optionally a side revenue
stream renting the screen to others.

## Why it fits
- A Cybertruck is already an attention magnet — strangers film it (the FB post
  that sparked this is literally a stranger's truck). Free earned media.
- It IS the brand: a tech-forward, AI-run appliance company should be seen in
  the most futuristic truck on the road. Nobody else in appliance repair looks
  like this.
- We just built the thing it should point at: text/talk-to-Ant + photo → instant
  AI diagnosis. The truck demos the whole consumer vision in the wild.

## Goal (decided 2026-06-13)
Promote **the Ant 🐜 platform + TN Appliance Exchange** — brand awareness + repair
leads. NOT renting the screen to others. **The offer is a paid $50 quick check**
(real tech diagnoses it, $50 credited toward the repair) — NOT a free diagnosis.

## Two revenue plays (do both)
1. **Lead-gen for TN Appliance / Ant** — drive repair calls + brand awareness.
2. ~~Rent the screen to other businesses~~ — dropped; this is our brand's billboard.

## The funnel (this is what makes it measurable)
Screen shows a dead-simple message + a QR + a number:
> "Appliance acting up? $50 quick check — we diagnose it right (credited to your repair)."

- QR → `truck.html?src=cybertruck` (the consumer landing we're building).
- The landing books a **$50 quick check** (real tech diagnoses it, $50 credited to
  the repair). Captures name/phone/zip/appliance + texts the office to follow up.
- Every scan + lead is tagged `source: cybertruck` in event_log, so we know
  exactly what the truck is worth: scans → diagnoses → leads → booked jobs.

## Message rules (2-second read at a stoplight)
- One idea, huge text, high contrast. QR big enough to scan from a car.
- Rotate a few: free-diagnosis hook / "we come to you" / a trust line (warranty,
  reviews). Keep brightness modest — driver-distraction rules.

## Practical
- **Hardware:** truck-bed-rail-mounted LED panel + inverter off the CT's power.
  Mount to rails/clamps, don't drill panels.
- **Legal:** a few TN/LA metros restrict *moving digital billboards* / brightness.
  Verify before committing to a digital (vs static wrap) screen.
- **Fallback:** a high-quality static wrap/magnet with the QR + line works too,
  zero power/legal fuss — good cheap test before the LED rig.

## Phased plan
- **Phase 1 (now):** trackable landing (`truck.html`) = $50 quick-check booking
  + `ad-lead.js` (lead capture + office SMS) + `source:cybertruck` tagging + QR.
  Test with a static decal/QR first — proves the funnel for ~$0.
- **Phase 2:** add the LED screen; rotate messages; watch the scan→lead numbers.
- **Phase 3:** if leads are strong, this becomes the launch billboard for the
  consumer platform (snap-a-pic diagnosis app) + rent spare screen time to others.

## North-star metric
Cost of the rig ÷ booked jobs it sources. The `source:cybertruck` tag makes that
a real number, not a vibe.
