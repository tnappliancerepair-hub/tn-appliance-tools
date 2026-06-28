# Wide Job-History View + Flaws to Fix (8,115 jobs, 2017–2026)

Built 2026-06-28 from the MeisterTask archive in Supabase.
Re-runnable: `meistertask-volume?secret=` and `meistertask-flaws?secret=`.
Stored: `meistertask_archive` rows `board='_volume'` and `board='_flaws'`.

## Volume — what we fix (8,115 cards; 7,256 appliance-classified)

| Appliance | Jobs | Top symptoms (real signals) |
|---|---|---|
| Refrigerator | 2,248 | **Ice maker 756**, Not cooling 367, Leaking 157 |
| Dishwasher | 1,869 | Not cleaning 112, Leaking 214, Not draining 94 |
| Dryer | 1,178 | **No heat / not drying 291**, Noisy 85, Not spinning 56 |
| Washer | 1,080 | Leaking 141, Noisy 100, Not draining 93, Not spinning 55 |
| Range/Oven | 840 | No heat 93, Burner/element 13, Igniter 8 |

**Component-level (the actual repair):**
**Ice maker 1,239** · Control/main board 170 · Door gasket 74 · Heating element 71 · Compressor 41 · Drive motor 23 · Drain pump 13.

> ⚠️ Data-quality note (honest): the symptom classifier has noise — "ice maker" bled
> into Dishwasher/Dryer counts (a card naming two appliances gets one tag), and "Error
> code" is over-broad. The **appliance totals and the big signals (ice maker, dryer no-heat,
> fridge not-cooling) are solid**; treat small symptom buckets as directional.

### Headline #1 — Ice maker is the single biggest repair you do
1,239 component hits / 756 fridge symptom. It's repeatable, well-understood, and the parts
are known (ACZ74170502, AEQ73449909, WR30X35285, MJX64711401…). **Nail this one price + pre-stock the parts and you've optimized your #1 job.**

## Flaws — the recurring problems we can fix (1,861 comment cards)

| Flaw | Cards | % | What it's costing you |
|---|---|---|---|
| **Scheduling churn / no-show / cancel** | 434 | **23.3%** | Wasted slots, warranty sending another company, "h/o said it's working / cancelled" |
| Chase overhead (warranty + customer follow-up) | 104 | 5.6% | Office time on "where's my part / status?" calls |
| Authorization friction (check-and-advise, $0 autho, over-limit) | 65 | 3.5% | Stalled jobs waiting on warranty approval |
| Callback / recall / "still not working" | 63 | 3.4% | Repeat trips, lost trust ("changed all components, still not working") |
| Second trip / wrong part / reorder | 31 | 1.7% | Double truck-rolls, half commission |
| Lost repair (buyout / cash-in-lieu / denied) | 21 | 1.1% | Repair revenue walks (e.g. $992.59 cash-out) |
| Parts back-order / long ETA | 13 | 0.7% | 6–8 wk waits → customer takes the buyout |

> ⚠️ Noise note: "scheduling churn" also catches legit reschedules, and "callback" catches
> some "call back to reschedule." The *direction* is real — cancellation/churn is by far the
> biggest drag — but the exact % is soft.

### Headline #2 — Scheduling churn (23%) is your biggest operational leak
Far bigger than parts or callbacks. Cancellations, no-shows, warranty pulling the job,
"homeowner said it's fine." **This is exactly what the self-scheduling autopilot + availability
capture + confirm-before-roll is built to attack.**

## Flaw → fix map (much of this already exists; this is CONNECTING, not building from scratch)

| Flaw | The fix | Status |
|---|---|---|
| Scheduling churn | Self-scheduling autopilot · availability captured at intake · day-before confirm · confirm-before-roll · fast warranty auto-accept (beat the other company) | autopilot planned; availability + auto-accept LIVE |
| Chase overhead | Parts-status auto-chase + vendor email parse · customer portal self-serve status · warranty status APIs (Frontdoor/ServicePower) | portal LIVE; claims-sync LIVE; Frontdoor API in progress |
| Authorization friction | Warranty API status/notes push + auto-claim · surface $0/over-limit autho to office instantly | ServicePower push LIVE (shadow); build auto-claim |
| Callback / not fixed | Pre-diagnosis before the truck rolls · intelligence layer (fault codes + our history) · first-visit-fix tracking | ant-troubleshoot LIVE; FVF metric to add |
| Second trip / wrong part | Marcone/Tribles part lookup + pre-order before visit · better part-number resolution (confidence corpus) | Marcone LIVE; pre-order flow to wire |
| Lost repair / back-order | Multi-source parts (Marcone+Tribles+Reliable+Amazon-eq) to dodge back-orders · faster ETA so they don't take the buyout | Marcone LIVE; add sources |

## Next (Teddy's call — discuss before approving)
1. **Discuss the flat-rate menu repair-by-repair**, starting with **ice maker** (your #1), then set each price together.
2. **Pick the top flaw to attack first** — recommendation: scheduling churn (23%), since it dwarfs the rest.
3. Then wire the approved menu into the Teddy Tool + drawer.
