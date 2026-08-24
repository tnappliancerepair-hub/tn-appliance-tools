# Ant — Trial Shop Onboarding Kit

How to stand up a new shop on the free "Ann answers your phone 24/7" trial, end to end.
Everything here is already built — this is the repeatable recipe, not new work.

---

## What the shop gets (the trial — the "simple tier")
- **Ann answers their phone 24/7**, warm, as *their* business.
- Answers basic questions from their own info block (hours, area, what they work on).
- **Captures every lead and texts it straight to the owner's cell** the second the call ends.
- Optional: the lead also lands as a **job on their own Ant board** + texts the customer an
  **intake link** (a video of the problem, a photo of the model sticker, their availability,
  and a quick release of liability).
- Free trial. Never quotes prices — Ann always says the owner will go over pricing on the
  callback. No scheduling, no warranty flow — that's the full Ant.

---

## Step 0 — Collect this from the shop (the only thing that gates go-live)

Send them this. It's all you need:

```
1. Business name (exactly how it should be said on the phone):
2. Your cell (where the lead texts land):
3. Your email:
4. Service area (e.g. "the Greater Nashville area" / a list of towns):
5. Your hours a live person follows up (Ann answers 24/7 regardless):
6. What you work on / don't (brands, appliance types — or for auto: makes, general vs classic):
7. Anything you're OK with Ann telling callers (rough pricing, "we do free estimates," etc.):
8. The phone:  (a) buy a new number for the trial, or
                (b) forward your current business line to it?
```

For **automotive** (Greg): also note **general repair vs classic/restoration** focus, and Ann
will capture **year / make / model** on every call.

---

## Step 1 — Add the shop to the registry
Edit `netlify/functions/_lib/trial-shops.js`, fill one entry:

```js
'joey': {
  name: 'Joey's Appliance Repair',           // said in full
  type: 'appliance',                          // 'appliance' | 'automotive'
  ownerFirst: 'Joey',
  ownerCell: '+16155551234',                  // E.164 — REQUIRED (lead lands here)
  area: 'the Greater Nashville area',
  hours: 'Monday to Friday, 8 to 5',
  about: 'We fix washers, dryers, fridges, dishwashers, ovens... free estimates on ...',
  platformSlug: '',                           // set to their tenant slug to also drop leads on their board
},
```

## Step 2 — Commit + push
`git commit` + push. Netlify auto-deploys. (The registry is code, so it's a one-line change.)

## Step 3 — Create their Ann
`…/trial-ann-admin?action=create&shop=joey`  → returns an **assistant_id**.

## Step 4 — Give Ann a phone number
`…/trial-ann-admin?action=bind&id=<assistant_id>&number=+1<their line>`
- New number: buy a Telnyx line first, then bind it.
- Their existing line: they set call-forwarding on their business number → the Telnyx number.

Test: **call the number.** Ann answers as the shop, captures a fake lead, and the owner's cell
gets the text. That's the trial live.

## Step 5 (optional) — Turn on their Ant board (phone→database bridge)
If they want the board + intake link too (not just SMS):
1. Create their tenant in the "ANT Platforms" Supabase project (a `company` + owner —
   `create_company_with_owner(...)`, mirror `docs/sql/006_demo_seed.sql`), note the **slug**.
2. Put that slug in the registry entry's `platformSlug`.
3. Now every lead Ann captures also becomes a job on their board + texts the customer the intake
   link. They sign into `…/platform/office-board.html`.

To re-push a persona tweak later: `…/trial-ann-admin?action=update&shop=joey&id=<id>`.

---

## What to hand them TODAY (while their line is set up)
Let them see the product now on the live demo tenant:
- **Office board:** `…/platform/office-board.html` (their kanban, notes, invoicing)
- **Tech app:** `…/platform/tech.html` (open a job: video, model OCR, brain, parts, report)
- **Customer intake + portal:** the links a lead generates

Sign-in for the demo shop ("Joey's Appliance Repair") = the demo owner login.

---

## The pitch, in one line
"We put an AI receptionist on your phone that never misses a call, texts you every lead the
second it comes in, and — if you want — runs your whole board, sends the customer a video +
model-photo intake, and invoices for you. Free to try."
