# Cash TDR — the unified TDR page (locked plan, 2026-08-11)

Design settled with Teddy on 2026-08-11, after the first real cash-out (Norman Giller,
job #21267) exposed the friction in the old flow.

## The decision
**Retire the separate "Teddy Tool" / "cockpit" (`teddy-tdr-tool.html`).** They were the
same page under two names, and they add an extra step. The **TDR page we already fill out
every day** — the one that's working great and is already messaged to the crew and Teddy —
becomes the single working surface for every job. Whatever link used to open the Teddy Tool
now opens the TDR page directly.

Teddy's words: *"The TDR page is well laid out. It's simple. It's easy. It's the most
efficient way of doing it. We're just adding an extra step by having the Teddy Tool."*

## The base TDR stays (it's perfect for warranty) — do NOT rebuild it
Add exactly two things to the TDR page:
- The customer's **video + pictures**, right on the page.
- **Model # → find the part** (the "six options" — model lookup surfaces the likely parts).

Then the page **forks by customer type**: a warranty job and a cash job are two different
pitches. Same front end (media + find-the-part), different back end.

## The distinct differences — warranty vs cash

| | 🛡️ Warranty | 💵 Cash |
|---|---|---|
| **Part number** | MUST be submitted to the warranty company for approval | Filled in **internally** for ordering; **NEVER shown to the customer** — they see it when the part physically arrives |
| **Diagnosis** | In-depth: what we did + what we plan to do (the claim needs it) | Simple: the customer just wants an honest diagnosis + advice |
| **Output** | Submit the claim (codes + part #) | Text the customer a few simple price options |
| **Goal** | Get the claim approved + paid | Make it a black-and-white, easy choice |

## The cash options — keep it DEAD simple, black and white
Two parts × two ways = **four clean prices, no part numbers, no clutter.** Don't give them
too many options.

- **Amazon part — shipped to you:** $X
- **OEM part — shipped to you:** $Y
- **Amazon part — we install:** $X + labor
- **OEM part — we install:** $Y + labor

Teddy's example: Amazon **$5**, OEM **$10**, labor **$100** → **$105** (Amazon + install) /
**$110** (OEM + install).

- Prices shown are **customer prices** — markup already baked in (see markup note below).
- **Labor** = the one rate Teddy types per job.
- **$50 Quick Check credit** comes off the **we-install** options only ("A"). **CONFIRMED
  2026-08-11 — keep it.**

## What the system does
Teddy punches in: the **part #**, the **Amazon cost**, the **Marcone/OEM cost**, the **labor
rate**. The system applies the markup + does the math → the four options → **Send → texts the
customer the options** (never the part number).

- Prices **auto-fill** from the lookups but are **always editable**, and are
  **discontinued-safe** (the API's discontinued stub — e.g. today's $1.26 on 5303935066 —
  never auto-fills as a real cost; it flags instead).

## Open item — markup number
The markup lives server-side (`qc_diagnosis_view`). The current system charges **30% markup**
(cost × 1.30). Danielle's documented rule is **cost ÷ 0.75** (25% margin ≈ 33% markup).
Building the preview to match the **current 30%** so the quote never mismatches the bill.
**CONFIRMED 2026-08-11 — keep 30% markup.** (Switching to cost ÷ 0.75 later is a one-line
server change + a Mac push if ever wanted.)

## The text-to-tech/owner notification (CONFIRMED 2026-08-11 — must keep working)
The siren that fires to the tech + Teddy as a customer fills in their info has been working
and is NOT to be lost. Only change: it texts the **new cash TDR page** instead of the Teddy
Tool link. **Type-aware:** the Teddy Tool link is ALSO texted on warranty jobs (pre-diagnosis,
brand-intelligence, warranty QC) — those stay pointed where they are; only the **cash** sirens
(`verify-quickcheck`, `cash-in-notify`, `free-quickcheck`, `quick_check_submitted`) repoint to
the cash TDR page. Repoint happens AFTER the page is proven on a real cash job (Norman).

## Build approach — don't break what works
1. Add the **cash fork onto the real TDR card** (`ant-tdr-card.js`) — the **warranty path
   stays byte-for-byte untouched.**
2. Gate the fork on the job's `customer_type` so a warranty job can never see the cash pitch,
   and a cash job never shows warranty codes or tries to submit a claim.
3. **Prove it on a real cash job (Norman #21267)** before repointing the cash links and
   retiring `teddy-tdr-tool.html`.
4. Build the cash side **alongside** the live tool — nothing is swapped until Teddy looks at
   it and says it's better. No rug-pull.

## Reuses (backend already works — this is a clean face on it)
- Load: `qc_cockpit_load` (job + customer + media/attachments).
- Save: `create_tdr` (stores `oem_part_our_cost_cents`, `amazon_part_our_cost_cents`,
  `labor_customer_cost_cents`, part #s, `parts_decision: ship_to_customer`, supplier).
- Customer view + 4-option math + markup + $50 credit + drop-ship: `qc_diagnosis_view` →
  `cash-tdr-customer.html` (already live).
- Send: `send_qc_diagnosis_to_customer` (texts the customer the options link).
- Part lookup: `marcone-lookup` (mSupply) + `parts-lookup-direct` (Amazon) — with the
  discontinued/supersession fix.
