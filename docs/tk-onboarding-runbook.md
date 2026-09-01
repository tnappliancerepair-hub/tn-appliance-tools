# TK ("The Appliance Guy") onboarding runbook — attach to the platform + CSR setup

_Prompted 2026-09-01: Teddy told TK his Ann is upgraded but "not attached to the spine yet"; TK replied
"I need to get my CSR to set it all up with you." This is the exact sequence to run — mostly blocked on
a few things TK's CSR sends us. **Everything here is verified against the live code** (platform-provision,
platform-import + Workiz adapter, trial-ann-admin, office-overview)._

---

## 0. The one distinction — do not conflate
TK is **two separate things**:
- **PARTNER** (row in `partner`, code `TK`, dashboard token `pt_2e274606b78803f0c1db43c52f3adbb3`, referral
  link `signup.html?ref=TK`). He refers OTHER shops and earns commission. **Already done.**
- **TENANT** — his OWN shop **"The Appliance Guy"** (slug `the-appliance-guy`, owner TK Cousins,
  cell +1 804-334-6984, trade appliance) as a `company` on the platform. **This runbook.**

⚠️ **Do NOT pass `&ref=TK` when provisioning his own tenant** — that stamps TK as the referrer of himself
and pays him a referral commission on his own account. `ref=TK` is only for the *other* shops he brings in.

---

## What we need from TK (his CSR gathers these — the "setup kit" below asks for exactly this)
| # | Item | Why | Where |
|---|---|---|---|
| 1 | **Workiz API token** | Imports his whole book (customers + jobs) onto his board — the "spine" | Workiz → **Settings → API** |
| 2 | **TK's email** | His owner login | — |
| 3 | **CSR's email** | Her login to walk + review the office | — |
| 4 | **His Ann phone line** | The number Ann answers (existing DID or we buy one) | — |
| 5 | **Hours / service area / FAQ** | So Ann answers right | confirm (open per `docs/tk-kpi-payroll-requirements-2026-08-27.md`) |

**#1 (the Workiz token) is the single unlock** for the whole import.

---

## The runbook (run at execution — set `SECRET` = the admin/ops key `VAPI_ADMIN_SECRET`)

### Step 0 — does his tenant already exist?
```
GET /.netlify/functions/platform-provision?action=tenants&secret=<SECRET>
```
Look for `the-appliance-guy`. If it's there, note its `company.id` and skip to Step 2/3.

### Step 1 — provision his tenant (needs TK's email)
```
GET /.netlify/functions/platform-provision?action=provision&secret=<SECRET>
  &slug=the-appliance-guy
  &name=The%20Appliance%20Guy
  &trade=appliance
  &owner_email=<TK's email>
  &owner_name=TK%20Cousins
  &owner_phone=+18043346984
  &plan=office
  &area=<e.g. Greater%20Richmond>
```
- **No `&ref=TK`** (self-referral — see §0).
- Idempotent by slug (safe to re-run). Capture `company.id` + `login.temp_password` (temp pw only returned
  for a brand-new auth user; `null`/`existing_user` if the email already exists).
- Then add TK to `_lib/trial-shops.js` with **`platformSlug:'the-appliance-guy'`** + his `ownerCell` (per the
  `next` hint the response returns) so his Ann tools bind to the board.

### Step 2 — CSR login (⚠️ role gap)
There is **no dedicated office/CSR login endpoint** — `addtech` mints a login but pins `role='tech'`.
Two ways to give the CSR access:
- **Simplest for the review (mirrors Danielle):** give the CSR an **owner login** on TK's tenant — office
  pages gate on **RLS, not role**, so an owner login opens every office surface. (Just run Step 1 with the
  CSR's email as a second `provision` call, or hand her TK's owner login for the walkthrough.)
- **Proper office role:** `platform-provision?action=addtech&secret=<SECRET>&slug=the-appliance-guy&tech_email=<CSR>&tech_name=<CSR name>` → then patch `app_user.role` `tech`→`office` via sb-admin-sql.

_(Follow-up idea, not blocking: add a first-class `action=addoffice` to platform-provision so CSR logins
don't need the manual role patch.)_

### Step 3 — import his Workiz book (needs the Workiz token) → **drive via the API, not the browser wizard**
POST JSON to `/.netlify/functions/platform-import`, `content-type: application/json`, **`key` on EVERY call**.
`SLUG=the-appliance-guy`, `TOKEN`=TK's Workiz token.
1. **Probe** (auth check):
   `{"do":"probe","source":"workiz","key":"<TOKEN>","secret":"<SECRET>"}` → expect `ok:true`,
   `key_hint` = last-4, `totals.customers.ok`/`.jobs.ok` true. (Workiz gives no grand count → totals `null`,
   that's normal.)
2. **Preview** (opens the run — capture `run_id`):
   `{"do":"preview","source":"workiz","company":"<SLUG>","key":"<TOKEN>","limit_pages":0,"secret":"<SECRET>"}`
   (`limit_pages:2` for a small watchable demo first).
3. **Commit loop** — repeat the identical call until `done:true`:
   `{"do":"commit","source":"workiz","company":"<SLUG>","run":"<run_id>","key":"<TOKEN>","secret":"<SECRET>"}`
   (~3 pages/call; cursor resumes; idempotent via `import_map` — nothing double-creates).
4. **Status** anytime: `{"do":"status","run":"<run_id>","secret":"<SECRET>"}`.

_Two Workiz bugs were fixed 2026-09-01 so this runs clean: preview no longer crashes on the missing
`technicians` key (`platform-import.js`), and the browser wizard now passes `key` on commit
(`platform/import.html`). Workiz has **no vaulted key fallback** (only HCP does), so the token must ride on
every call — which the runbook does._

### Step 4 — attach his Ann to his board (the "spine")
Prereq: his `trial-shops` entry has `platformSlug` (= his `company.slug`) + `ownerCell`, and his Workiz data
is on the board (Step 3).
- **If he already has an assistant** (his upgraded trial Ann):
  1. `trial-ann-admin?action=preview&shop=<tk>&secret=<SECRET>` → confirm `precall_wired:true`,
     the webhook shows `platform-precall?slug=<board>`, and `tool_names` includes
     `get_status, get_hours, request_day, callback, send_link`.
  2. `trial-ann-admin?action=update&shop=<tk>&id=<assistantId>&secret=<SECRET>` → rebuilds the live assistant
     with the board-slug-baked precall webhook + full call-brain toolset. **Now she greets each caller by name
     and knows their job.**
- **If he has no assistant yet:** `add_shop` → `preview` → `create` → `bind`(his number) → **`update` again**.
  (Footgun: the transfer tool only attaches when both `annNumber` + `ownerCell` are set; `bind` writes
  `annNumber`, so the second `update` is what makes transfer land.)

### Step 5 — hand the CSR her review page
- **`/platform/office-overview-tk.html`** — the CSR logs in and walks every office surface **on TK's own
  data**, marks Keep/Change/Remove, and one-taps "Copy my review" to send back to TK. This is where Teddy's
  "we'll customize it to whatever helps her most" gets delivered — her review list is the customization spec.

---

## ✅ Definition of done
His Workiz book is on his board · his Ann answers his line recognizing callers by name+situation · TK + CSR
have logins · the CSR has walked `office-overview-tk.html` and sent her keep/change/add list.

---

## 📩 Forward to TK (paste into a text/email)

> Here's exactly what your CSR needs to send over so we hook you up to the spine — after that, most of the
> work is on us:
>
> 1. **Your Workiz API token** — in Workiz, go to **Settings → API** and copy the token. That's the big one:
>    it pulls your whole customer + job history onto your new board.
> 2. **Your email** and **your CSR's email** — so we set up both of your logins.
> 3. **The phone number you want Ann to answer** (your current line, or we'll grab you one).
> 4. A quick confirm of your **hours, service area, and any FAQ** you want Ann to know.
>
> Once your CSR sends those four things:
> - Your book imports onto your board (nothing deleted in Workiz — you keep it running until you're sure).
> - Ann starts answering every call **knowing who's calling and what they've got going on** — by name.
> - Your CSR gets a login + a simple page to walk the whole office and tell us what to keep, change, or add.
>   We build it around how *she* works — whatever helps her most.
>
> Reach out anytime. Don't make too much money. 🐜
