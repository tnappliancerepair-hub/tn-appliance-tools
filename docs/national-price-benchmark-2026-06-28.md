# National Price Benchmark vs. TN Appliance Flat-Rate Menu (2026-06-28)

National figures pulled from published consumer pricing (HomeGuide, Angi, HomeAdvisor,
Fixr, ConsumerAffairs, 2025–26). NOTE: national numbers are **all-in (parts + labor)**;
our menu is **flat labor + live part (cost ÷ .75)**. "Your all-in" below uses a typical
live Marcone part. Verdict compares all-in to all-in and labor to labor.

> ⚠️ Tariff note from the data: parts (boards, compressors, motors) are up 5–20% in 2025,
> which *raises* the national all-in — another reason not to underprice.

| Repair | Your labor | Your all-in (typical) | National all-in | National labor | Verdict | Suggested labor |
|---|---|---|---|---|---|---|
| **Ice maker** | $110 | $183 (WPL) | **$260** ($200–350) | $85–160/hr +SC | 🔴 UNDER | **$140** |
| Door gasket/seal | $110 | ~$177 | $150–250 | $50–150 | 🟢 at market | $115 |
| Water inlet valve | $110 | ~$180 | $100–250 (avg ~$175) | $70–125 | 🟢 at market | keep |
| Water line/dispenser | $130 | ~$200 | $140–250 | — | 🟢 at market | keep |
| **Evaporator/cond. fan** | $140 | ~$210 | **$250–400** | — | 🟠 under | **$175** |
| Defrost system | $140 | — | $200–400 (fridge mid) | — | 🟠 slightly under | $160 |
| Thermostat/temp control | $110 | — | $100–300 | — | 🟢 at market | $120 |
| **Compressor / sealed** ⚠️ | $375 | — | **$700–1,250** | **$500–850** | 🔴🔴 WAY UNDER | **$600** |
| Washer drain pump | $130 | ~$160 | $150–300 | $75–150 | 🟢 at market | keep |
| Washer bearing/tub ⚠️ | $300 | — | $150–250 (consumer) | $100–300 | 🟡 discuss* | keep $300 |
| Washer door lock/lid | $120 | — | $100–300 ($110–200) | — | 🟢 at market | keep |
| Washer shocks/suspension | $130 | — | $100–350 ($150–300) | — | 🟢 at market | keep |
| **Washer drive motor** | $160 | — | **$300–500** | — | 🟠 under | **$200** |
| Dryer heating element | $110 | $209 | $230 ($100–350) | $60–150 | 🟢 at market | $125 |
| Dryer belt | $130 | ~$160 | $100–250 (~$150–200) | $90–180 | 🟢 at market | keep |
| Dryer thermal fuse | $100 | ~$120 | $75–150 (fuse) | — | 🟢 at market | keep |
| Dishwasher drain pump | $130 | — | $100–250 | $75–125 | 🟢 at market | keep |
| **Dishwasher wash pump** | $160 | — | **$200–350** | — | 🟠 under | **$180** |
| Dishwasher water valve | $110 | — | $100–250 | — | 🟢 at market | keep |
| Dishwasher supply/leak | $130 | — | $50–300 | — | 🟢 at market | keep |
| Oven bake/broil element | $120 | $229 | $150–350 | $80–150 | 🟢 at market | keep |
| Oven surface burner | $120 | — | $150–300 | — | 🟢 at market | keep |
| Oven igniter | $110 | ~$150 | $150–325 | — | 🟢 lower end | $120 |
| **Control / main board** ⚠️ | $120 | — | **$300+** (part >$200) | **$250–350** | 🔴 UNDER (labor) | **$185** |
| User interface/display | $110 | — | $200–350 | — | 🟠 under | $130 |
| Full door replacement | $150 | — | varies widely | — | 🟡 discuss | discuss |
| Service call / diagnostic | $95 | — | $50–130 | — | 🟢 at market | keep |

\* Bearing: consumer averages ($175) undercount a real 2–3 hr teardown; your $300 is
defensible for the actual labor. Discuss whether to hold or trim slightly.

## The pattern (this is the answer to "are we treating ourselves fairly?")
**You're spot-on at market for the quick swaps, and UNDERPRICED on the skilled/heavy jobs** —
exactly where your expertise is worth the most:
- 🔴🔴 **Compressor/sealed system** — your $375 labor vs national $500–850. Biggest leak.
- 🔴 **Control/main board** — $120 vs national $250–350 labor.
- 🔴 **Ice maker** (your #1 job, 1,239 of them) — $183 vs $260 all-in. Small per-job gap × huge volume = real money.
- 🟠 **Evaporator fan, washer motor, dishwasher wash pump, user interface** — modestly under.

## Recommended new flat-labor (for approval)
Ice maker **$140** · Evap/cond fan **$175** · Defrost **$160** · Temp control **$120** ·
Compressor **$600** · Washer drive motor **$200** · Dryer heating element **$125** ·
Dishwasher wash pump **$180** · Oven igniter **$120** · Control board **$185** · UI/display **$130**.
Everything else holds at the current number (at market). Bearing + full door = discuss.

> Approve as-is, or adjust any number, and I'll lock it into `_lib/repair-menu.js` → flows
> straight into the Teddy Tool. If you have the Blue Book, read me its compressor + control-board
> + ice-maker labor numbers and I'll cross-check these against the trade standard.
