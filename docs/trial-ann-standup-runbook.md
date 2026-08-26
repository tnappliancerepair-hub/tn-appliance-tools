# Trial-Ann standup — hand a shop a live AI phone in minutes (runbook + spec)

**Status:** runbook (as-is) + one build to make it instant · **Date:** 2026-08-26
**Why:** the multi-tenant board alone doesn't wow anyone — HCP has a board. The wow is
**Ann answering a real number, capturing the lead, and dropping it on the shop's board
live.** That's the differentiator to put in a prospect's hands (TK first). Greg (Classic
Automotive) is already live this exact way — the pattern is proven; this makes it repeatable.

## The demo that actually lands (choreography)
1. On a call/screen-share, show YOUR Xano shop for the "it does all that?" vision.
2. Then: **"Call this number right now."** The prospect calls their own trial Ann.
3. Ann answers warm, 24/7, captures name + callback + what they need.
4. **The lead texts the owner's phone AND pops onto their board in real time** while they
   watch. That's the "wait, this is real" moment the bare board can't deliver.
5. Close on founding-partner terms (free while we build it out; deep tools port over time).

## The 90-second intake (collect this from the prospect)
Everything Ann needs per shop — one text back from them covers it:
- **Business name** (exactly as said on the phone — "Classic Automotive")
- **Owner first name** (Ann says "I'll get this right to Greg")
- **Owner cell, E.164** (`+1615…`) — where the lead text lands · **REQUIRED**
- **Type:** appliance | automotive | dealership (sets Ann's persona)
- **Service area** phrase ("the Greater Nashville area")
- **Human hours** ("Mon–Fri 8 to 5") — Ann answers 24/7, tells callers when a person follows up
- **About** (optional but huge) — services, brands, what they do/don't work on, any pricing
  they're OK with her quoting. This turns Ann from lead-catcher into a real CSR. She answers
  ONLY from this; anything past it she routes to a callback.
- **Email** — for their platform login (so leads land on their own board)
- **Phone plan:** buy them a fresh Telnyx line, or forward their existing business line?

## Standup flow — NO deploy needed (data-driven registry is LIVE, 2026-08-26)
All API calls, ~3 minutes on a call. `&secret=<VAPI_ADMIN_SECRET>` on every trial-ann-admin call.
1. **Register the shop (no code, no deploy):**
   `trial-ann-admin?action=add_shop&slug=<slug>&name=<Shop Name>&type=appliance&owner_first=<First>&owner_cell=+1<cell>&area=<area>&hours=<hours>&about=<what she can answer>&email=<login email>&platform_slug=<tenant slug if giving them a board>`
   (Idempotent — re-send to add the `about` or fix a field later. Only params you pass are written.)
2. **Phone number:** `telnyx-provision?action=searchnew` → `…&action=buynew&number=+1…`
   to buy a line (a vanity number that spells their name is a nice touch — Greg's spells GREG),
   OR have them forward their business line to the number.
4. `trial-ann-admin?action=create&shop=<slug>` → returns the assistant_id (auto-saved to the store).
5. `trial-ann-admin?action=bind&id=<assistant_id>&number=+1<their line>&shop=<slug>` → inbound routes to Ann.
6. **(the magic)** if you set `platform_slug` in step 1, `platform-provision` their tenant →
   every lead Ann catches ALSO becomes a job on their board + mints a customer portal link.
   This is the phone→board bridge that makes the demo pop.
7. Test-call the number yourself before handing it over.
   Check what's registered anytime: `trial-ann-admin?action=shops&secret=…`.

Reference: Greg's fully-populated entry in `trial-shops.js` is the template — real Ann line,
assistant, platform tenant (`classic-automotive`), leads → board, all wired.

## Phone number options (pick per shop)
- **Buy a Telnyx line (recommended for a demo):** instant, ~$1/mo + usage, you control it,
  can spell their name. Best for a trial you might turn off.
- **Forward their existing line:** no new number, but needs them to set call-forwarding and
  they keep control of the number. Better once they commit.

## Pricing / founding-partner tie-in
`planPrice` on the shop entry = what they pay/mo (0 = free trial). For founding partners:
0 while we build it out → locked founding rate later → a referral cut on shops they bring.
(TK: free founding partner + a cut on his group — that's the whole offer.)

## ✅ BUILT 2026-08-26 — the data-driven registry (no more code edit + deploy)
`add_shop` + `getAsync`/`putStore` are live. Configs live in Supabase `trial_shop`
(run `docs/sql/012_trial_shop.sql` once). `_lib/trial-shops.getAsync()` reads FILE-FIRST
(Greg + curated shops resolve instantly and never depend on the store), then the store for
new shops; any store hiccup degrades to the file so an existing shop can never break. `create`
auto-persists the assistant_id, `bind&shop=` the number. Original design notes below.

## ⭐ THE ONE BUILD to make this a true few-minutes flow
**Kill the code-edit + deploy in step 1–2.** Today a new shop = editing `trial-shops.js`,
committing, and waiting on a Netlify deploy — fine for us, not "stand it up on the call."

**Fix: a data-driven registry.** Move shop configs out of the JS file into a store the app
reads live (Supabase `trial_shop` table, or the existing vault), and add
`trial-ann-admin?action=add_shop&...` that writes the entry from URL params (name, cell,
type, area, hours, about, email). Then standing up a shop is:
1. `add_shop` (writes the config — no deploy)
2. `buynew` (a number)
3. `create` → `bind`
…all API calls, done in ~3 minutes on the call, no commit, no deploy. `trial-shops.js`
becomes the fallback/seed; live configs come from the store. Backwards-compatible: the
registry loader checks the store first, then the file.

**Effort:** small — a table/vault read swap in `_lib/trial-shops.js` + one `add_shop` action
in `trial-ann-admin.js`. Everything downstream (create/bind/lead/platform bridge) is unchanged.

## Do NOT
- Lead the pitch with the bare board — lead with Ann on a live number.
- Hand over a number you haven't test-called.
- Over-promise the deep tools (warranty/pay/brain) as "in your copy today" — they're the
  roadmap; the trial is Ann + board + portal.
