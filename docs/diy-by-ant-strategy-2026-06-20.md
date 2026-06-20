# DIY by Ant — Strategy (locked 2026-06-20)

A **second, separate category** alongside our local appliance-repair business:
a **national** offering that courts the do-it-yourself homeowner — the person who
wants to fix their own dryer/washer/stove and just needs to know **which part to
order.** Two doors, one house: same diagnosis brain, different customer, different
money.

> Decided with Teddy 2026-06-20. This is the north star — build against it.

---

## 1. The wedge — why this wins
DIYers can already find parts anywhere (Amazon, RepairClinic, PartSelect). **What
they can't do is figure out WHICH part they need.** "My Whirlpool washer won't
drain — is it the pump, the lid switch, or the control board?" Guess wrong = $80
and a week wasted. **Ant's diagnosis solves exactly that.** Nobody in the parts
space leads with the diagnosis. We do.

**Positioning:** *"Tell Ant what your machine is doing — Ant tells you what's
wrong and the exact part to order."*

## 2. What Ant DOES (and explicitly does NOT) do
**DOES (deliverable today):**
- Conversational **troubleshooting** — symptom → likely cause.
- **Exact-part match** — model # + symptom → the specific part number + buy link.
- **Fault-code lookup** — "Samsung 4C = drain/water-supply."

**DOES NOT (decided — don't sell what we can't nail):**
- ❌ **No step-by-step install coaching.** Harder, more liability, and Ant isn't
  reliable at "remove the 3 screws on the left" yet. We diagnose; we don't
  walk them through the wrench work.

## 3. The customer flow
1. DIYer lands from a problem search ("dryer won't heat").
2. **Free troubleshooting** — Ant chats, gives the general direction. (The hook.)
3. **$20 "Part Match"** — Ant locks in the **exact part number for their model**
   + buy link. **The $20 credits toward the part** if they order from us
   (mirrors the repair-side $50 Quick Check → credited to repair).
4. **Buy the part** — dropship, our markup.
5. Too risky / they give up → **funnel to repair** (only if they're in TN/LA).

## 4. Money
- **Parts markup** (the core).
- **$20 Part Match** — covers our per-minute AI cost; credited to the part, so
  it's a no-brainer for the customer and converts straight to a part sale.
- Free troubleshooting tier keeps friction low for the top of the funnel.

## 5. Fulfillment — dropship, never touch inventory
- **Marcone API** = primary (OEM). *Pending — "weeks out" per integration notes.*
- **Amazon** = aftermarket tier. *Dropship side still needs to be set up.*
- **Bridge:** launch the **diagnose + recommend + collect-order** flow before the
  auto-order APIs are live; **fulfill manually** at first, flip on true dropship
  when Marcone/Amazon are wired.

## 6. Liability — "learning purposes, at your own risk" + hard gates
- Frame all guidance as **educational / for learning purposes — work at your own
  risk** (the iFixit / RepairClinic / YouTube posture). Lowers liability and it's
  honest.
- **"At your own risk" covers the safe 90%** (belts, heating elements, thermal
  fuses, pumps, switches, door seals).
- **Hard-gate the dangerous 10% → diagnose-only, route to a pro:**
  - 🔥 **Gas** (gas dryers/ranges)
  - ⚡ **240V hardwiring**
  - ❄️ **Sealed system / refrigerant** (EPA-licensed only)
- Ship a clear TOS + an on-page disclaimer before any guidance.

## 7. SEO — national, organized by PROBLEM (not city)
The opposite of the repair pages. Repair is local → city pages. **DIY is national
→ there are no cities.** Pages are organized by:
- **Symptom guides:** "Dryer not heating," "Dishwasher won't drain," "Fridge not
  cooling."
- **Brand + model + error code:** "Samsung washer 4C error," "LG fridge flashing
  temp."
- **Part guides:** "Dryer heating element — what it does, how to know it's bad."

**"Strategic for site strength":** start with a **tight set of the highest-demand
problems, made genuinely excellent**, and expand as they rank — NOT thousands of
thin pages on day one (the city-page mistake). Earn authority on quality, then
scale.

## 8. Relationship to repair — two doors, one house
| | **Repair** (existing) | **DIY by Ant** (new) |
|---|---|---|
| Customer wants | someone to fix it | to fix it himself |
| Reach | local (TN + LA) | **national** |
| Money | service / labor | **parts markup + $20 Part Match** |
| Searches | "appliance repair near me" | "why won't my dryer heat" |
| Shared | **same diagnosis brain, same parts engine** | |

The DIY page **funnels the too-hard / too-scary jobs into repair** (if local) — so
it feeds both sides instead of competing.

## 9. Rollout — dryers first
**Nail ONE appliance, then copy the playbook.** Start with **dryers** — simplest,
safest, cheapest common parts (heating elements, thermal fuses, belts, rollers),
highest DIY win rate, lowest danger.

**Phase 1 (dryers):**
- DIY hub page + 8–10 killer dryer symptom/part guides.
- Free troubleshooting + $20 Part Match flow (manual fulfillment to start).
- Disclaimer/TOS + safety gates.
- Prove it ranks + sells.

**Phase 2+:** roll the same playbook to washers → dishwashers → ranges →
refrigerators (refrigerant-gated).

## 10. Existing assets to reuse (don't rebuild)
- `netlify/functions/ant-troubleshoot.js` — the grounded troubleshooting brain.
- `netlify/functions/find-part-number.js`, `parts-finder.js`, `get-parts-lookup.js`.
- `netlify/functions/ocr-model-extract.js` — read the model sticker from a photo.
- `_lib/ant/fault-codes.json` + `fault-code-lookup.js` — fault-code DB.
- `appliance-ai.html` — the AI intake pattern (Quick Check) to fork for DIY.
- The **Marcone live daemon** (`colony-loop/parts/serve.js`) — live part lookup today.
- Amazon Business scaffold (`_lib/amazon-business.js`) — dropship target.

## 11. Open / next decisions
- **$20 Part Match pricing** — start at $20 credited; A/B free-vs-$20 later.
- **Manual fulfillment process** for the bridge period (who orders, how we ship).
- **TOS / disclaimer copy** + the exact hard-gate trigger list.
- **First 8–10 dryer guides** — pick the highest-search-volume symptoms.
- Brand: same "TN Appliance Exchange / Ant" brand, DIY as a section (decide URL —
  e.g. `/diy` hub).

---

**Bottom line:** free troubleshooting → $20 exact-part match (credited to the
part) → dropship the part → too-risky funnels to repair. National reach, problem-
based SEO, dryers first, educational/at-your-own-risk with hard safety gates. A
clean, defensible second business that runs on the brain we already built.
