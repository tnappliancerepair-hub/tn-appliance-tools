# Flat-Rate Repair Menu — DRAFT (seeded from 8 yrs of job history)

Built 2026-06-28 by mining 164 diagnosis blocks out of the MeisterTask comment
archive (the "DIAGNOSIS / PARTS THAT FAILED / LABOR HOURS" TDR notes).

## How to read this
- **Model:** price **by the job** (one flat number to the customer), calibrated to
  **~$100/hr-equivalent**. NOT hourly.
- **Flat labor $** = typical job time × $100, rounded to a clean number. **Parts are
  billed on top** at Danielle's formula (`cost ÷ .75` at $30+, `cost + $10` under $30).
- **Seen** = how often that repair showed up in history (your real volume ranking).
- ⚠️ **VERIFY — price up:** the historical time came off fast/low-pay warranty jobs and
  is too low for the real self-pay job. Teddy sets the real flat price on these.

> Final price to customer = **Flat labor (below)** + **part(s) at cost ÷ .75**.
> Set the real numbers in the right column and I'll wire it into the drawer + Teddy Tool.

---

## 🧊 Refrigerator (your #1 appliance — 31% of all jobs)

| Repair | Seen | Hist. time | Draft flat labor | Common OEM parts | Teddy's flat price |
|---|---|---|---|---|---|
| Ice maker | 24 | 1.0h | **$100** | ACZ74170502, AEQ73449909, WR30X35285, MJX64711401 | ____ |
| Door gasket / seal | 15 | 1.0h | **$100** | WD08X10057, WR14X27230/27231, WR01X27364 | ____ |
| ⚠️ Compressor / sealed system | 12 | 1.0h | $100 → **verify (2–4h job)** | W10503278/WPW10503278, W10594330 | ____ |
| Water line / dispenser | 12 | 1.5h | **$150** | WP3385089, W11465533, W10352226 | ____ |
| Water inlet valve | 10 | 1.0h | **$100** | W11025984, W11038711, W11210459 | ____ |
| Evaporator fan | 3 | 1.0h | **$100** | W11671461, ADQ73913310 | ____ |
| Defrost system (heater/thermostat) | 2 | 1.0h | **$100** | — | ____ |

## 🌀 Washer (15%)

| Repair | Seen | Hist. time | Draft flat labor | Common OEM parts | Teddy's flat price |
|---|---|---|---|---|---|
| Drain pump | 6 | 1.5h | **$150** | WH01X32580, WH01X29528, WH11X29539 | ____ |
| ⚠️ Bearing / spider / tub | 2 | 1.5h | $150 → **verify (2–3h teardown)** | W11643701, W11742939, W11335100 | ____ |
| Door lock / lid switch | 3 | 1.5h | **$150** | W10653840/WPW10653840, W11589973 | ____ |
| Shocks / suspension | 4 | 1.0h | **$100** | ACV72909503 | ____ |
| Drive motor / clutch | 2 | 1.0h | **$100** | WE17X10010, WH05X24185 | ____ |

## 🔥 Dryer (16%)

| Repair | Seen | Hist. time | Draft flat labor | Common OEM parts | Teddy's flat price |
|---|---|---|---|---|---|
| Heating element | 8 | 1.0h | **$100** | WD22X10063, WD08X10032, W11025156 | ____ |
| Belt | 3 | 1.5h | **$150** | WH16X26911, WH03X30517, WH01X24180 | ____ |
| Thermal fuse / thermostat | 2 | 1.0h | **$100** | WE04X36457, WE04X25587, W10258275 | ____ |

## 🍽️ Dishwasher (26%)

| Repair | Seen | Hist. time | Draft flat labor | Common OEM parts | Teddy's flat price |
|---|---|---|---|---|---|
| Supply line / leak | 7 | 1.5h | **$150** | W11454372, AEC74337401, W11162042 | ____ |
| Wash pump / motor | 4 | 1.0h | **$100** | — | ____ |
| Water inlet valve | (see formula) | — | **$100** | — | ____ |

## ♨️ Range / Oven (12%)

| Repair | Seen | Hist. time | Draft flat labor | Common OEM parts | Teddy's flat price |
|---|---|---|---|---|---|
| Bake / broil element | 5 | 1.5h | **$150** | WB23M24, EBR74164802, AEB73944601 | ____ |
| Surface burner / element / switch | 2 | 1.5h | **$150** | WB30X47331, WB24X25013, WB24T10022 | ____ |
| Oven igniter | 3 | 1.0h | **$100** | WP8054129, WR55X26671, WPW10331686 | ____ |

## 🔧 Cross-appliance (any unit)

| Repair | Seen | Hist. time | Draft flat labor | Common OEM parts | Teddy's flat price |
|---|---|---|---|---|---|
| Control / main board | 16 | 1.0h | **$100** | DD8102282A, WH22X33178, W11395618 | ____ |
| User interface / display / panel | 6 | 1.0h | **$100** | W10539780, WR17X13242, WR55X11144 | ____ |
| Thermostat | 2 | 1.5h | **$150** | WE04X25280, WE04X26214, WE11X21156 | ____ |
| ⚠️ Full door replacement | 4 | 1.0h | $100 → **verify (varies)** | W11551301, W11116025 | ____ |

---

## Notes / next
- **Service-call minimum / diagnostic:** history shows ~$75 collected at the door on
  warranty; for self-pay set the real diagnostic/service-call fee (rolls into the repair
  if they proceed). Decide the number.
- The ⚠️ rows are under-priced by the historical time — set real flat prices.
- Once Teddy fills the right column, wire `flat_rate_menu` into the Teddy-Tool / drawer
  so it auto-suggests the flat price by repair type, and pre-loads the common parts at
  `cost ÷ .75`. Self-pay quoting becomes one tap.
- Full machine-readable data: Supabase `meistertask_archive` row `board='_repair_menu'`
  (also re-runnable: `meistertask-repair-menu?secret=&min=N`).
