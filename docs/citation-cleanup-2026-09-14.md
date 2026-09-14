# Off-site citation cleanup — the "used appliance store" ghost + the phone mismatch
**Audited 2026-09-14.** Everything here is OFF-SITE. Our own website is clean and needs no changes.

---

## What the audit proved

**✅ The website is clean.** Every "used appliance" string on the site is the deliberate DENIAL —
*"We do not sell used appliances"* / *"No, we're a repair shop, not a used-appliance store."* Schema
is correctly typed as a service (`LocalBusiness`/`ApplianceRepair`), **never** `Store`. Nothing to fix.

**✅ The phone numbers are already right, per metro.** Audited every page by geography and by the
`tel:` link a customer actually taps:

| pages | number shown |
|---|---|
| **TN pages** | 629 Nashville (479) · 931 Clarksville (42) — all TN |
| **LA pages** | 985 North Shore (293) · 504 New Orleans (209) · 225 Baton Rouge (166) — all LA |
| community/church pages | 888-268-8998 (ANT-8998 toll-free — national program, correctly non-geo) |

⚠️ **Do NOT bulk-normalize these.** The per-metro locals are real Telnyx lines and are better for
local SEO. This was mis-audited once before as "fake placeholders" and 1,353 pages were wrongly
normalized, then `git revert`ed. Gonzales reads as a "generic" page in a naive classifier but is
Gonzales **Louisiana** — its Baton Rouge number is correct.

---

## 🔴 Finding 1 — the ghost is a whole legacy IDENTITY, not just a category tag

The directories are not mis-categorizing the repair company. They are carrying a **different,
older business record** that shares the name:

| | the ghost listing | the real business |
|---|---|---|
| name | TN Appliance Exchange **Inc** | TN Appliance Exchange **LLC** |
| address | **5403 Murfreesboro Rd, La Vergne, TN 37086** | 3137 Skinner Dr, Antioch, TN 37013 |
| what it is | **refurbished appliance DEALER** — "sells appliances and offers trade-in value on old machines" | appliance **repair**, 24/7 |
| hours | retail storefront: Mon 12-5, Tue-Sat 10-5, closed Sun | 24/7 |
| reviews | ~30 on Yelp | 1,100 on Google (4.5★) |

That is why a search for **our own name** returns "TOP 10 BEST Used Appliance Store near Antioch."
Google and the AI engines are reading a used-appliance dealer record attached to our brand name.

**⏭️ TEDDY — CONFIRM FIRST:** is "TN Appliance Exchange Inc" at 5403 Murfreesboro Rd a former
version of this business, or an unrelated company with a similar name? The cleanup differs:
- **Ours (predecessor):** claim each listing and either update it to the repair business or mark it
  permanently closed. Marking closed is usually better — it kills the used-appliance association
  outright instead of leaving a second record competing with the real one.
- **Not ours:** do not claim. Instead report each as a duplicate/incorrect listing so the platforms
  stop merging its category into our brand.

### The listings carrying it
| platform | URL | what it says |
|---|---|---|
| **Yelp** | `yelp.com/biz/tn-appliance-exchange-la-vergne` | "refurbished appliance dealer... specializing in refurbishing used washers, dryers, stoves, and refrigerators" · 30 reviews · La Vergne |
| **BBB** | `bbb.org/us/tn/la-vergne/profile/used-appliances/tn-appliance-exchange-0573-37137914` | filed under the **`used-appliances`** category — it is in the URL |
| **YellowPages** | `yellowpages.com/antioch-tn/used-appliances` | "a refurbished appliance store that sells appliances and offers trade-in value" |

---

## 🔴 Finding 2 — every directory publishes the OLD phone number

Our GBP and our whole site say **(629) 272-1234**. The directories say **(615) 280-2949**.
Inconsistent name-address-phone is one of the few things local ranking genuinely punishes, and it
means an AI answer hands a stranger a different number than our own listing.

| platform | phone shown | verified |
|---|---|---|
| RepairHit | (615) 280-2949 | ✅ fetched |
| CityLifestyle | (615) 280-2949 | ✅ fetched — also describes us as "appliance **exchange** services" |
| Manta | (615) 280-2949 | from search snippet (page blocks bots) |
| MagicPin · TheApplianceDirectory · YellowPages | (615) 280-2949 | from search snippets |

**Decide the canonical number first, then make every listing match it.** GBP currently says
629-272-1234, so that is the one to standardize on unless Teddy wants otherwise.

---

## 🟡 Finding 3 — the review count is stale everywhere

AI quotes **"974 reviews."** We are at **1,100** (4.5★, verified live off the Business Profile API).
We are being undersold by 126 reviews in the exact place a stranger checks. This corrects itself on
most directories once the listing is claimed and refreshed.

---

## The work, in order of payoff

1. **Yelp** — highest authority, and the worst offender (full "refurbished dealer" description).
   Claim or report `tn-appliance-exchange-la-vergne`.
2. **BBB** — the `used-appliances` category is in the URL itself. Claim the profile and change the
   category to Appliance Repair, or close it.
3. **YellowPages** — remove from the `used-appliances` category.
4. **Phone sweep** — RepairHit, CityLifestyle, Manta, MagicPin, TheApplianceDirectory → 629-272-1234.
5. **Old domain** — `tnappliancerepair.com` (the retired HCP/Duda site) should 301 to
   `tnapplianceexchange.net` if it still resolves. A live old site is an off-site billboard for the
   wrong intent.

## What is NOT the problem
- Our website (clean, verified twice).
- Our GBP category (primary = Appliance repair service; no store category — verified live).
- Our per-metro phone numbers (correct as built).

---

# ✅ CONFIRMED 2026-09-14: the La Vergne dealer record IS Teddy's old shop

Teddy: *"It's my old shop."* So this is a predecessor identity, not a stranger with a similar name.
That settles the approach — and the approach is **CONVERT, not close.**

## Why convert instead of mark-closed
There is only **ONE** Yelp listing for this brand and it is the old one (searched; no separate
Antioch repair listing exists). Marking it permanently closed leaves us with **zero Yelp presence**
plus a "Permanently closed" ghost that still surfaces. Converting keeps the **30 reviews** and the
page authority while flipping the category that is doing the damage. Same logic on BBB.

⚠️ The only case for closing is if a SECOND, current listing already exists on that platform —
then you close the old one to avoid two competing records. Check before acting, per platform.

## The canonical record to push everywhere
| field | value |
|---|---|
| name | TN Appliance Exchange LLC |
| address | 3137 Skinner Dr, Antioch, TN 37013 |
| phone | **(629) 272-1234** (matches GBP + all 714 site pages) |
| category | Appliance **Repair** — never "Used Appliances" / "Appliance Store" |
| hours | 24/7 |
| website | https://tnapplianceexchange.net |
| description | Technician-led appliance repair, family-owned since 2012. **We repair appliances; we do not sell used ones.** |

⚠️ **Before standardizing the phone, confirm (615) 280-2949 still rings.** It is a live Telnyx line
and it is what 6 directories publish. If it is dead, those listings are sending real customers to a
dead number — that is worse than the inconsistency and should be fixed first.

## Platform-by-platform

### 1. Yelp — biggest impact, do first
- `biz.yelp.com` → Claim your business → search "TN Appliance Exchange" (La Vergne).
- ⚠️ Verification calls the number ON the listing (the old one). If that line is dead, use Yelp's
  alternate verification (email/document) or open a support ticket.
- Once claimed, change: **address → Antioch**, **categories → Appliance Repair** (remove any
  used/retail category), **hours → 24/7**, **phone → 629-272-1234**, **description → repair**.
- Yelp sometimes locks category changes in the UI — if so, Yelp support can change it on request.
  Say plainly: "the business changed from used-appliance sales to appliance repair."

### 2. BBB — the category is literally in the URL
`bbb.org/us/tn/la-vergne/profile/used-appliances/tn-appliance-exchange-0573-37137914`
- Claim the profile, change category **Used Appliances → Appliance Repair**, update address + phone.
- The URL slug may not update itself — ask BBB support to re-slug it. That slug is a ranking signal
  for the wrong term.

### 3. YellowPages
Listed under `yellowpages.com/antioch-tn/used-appliances` as "a refurbished appliance store that
sells appliances and offers trade-in value." Claim → recategorize → update phone.

### 4. The long tail (phone + category only)
RepairHit · CityLifestyle (also calls us "appliance **exchange** services") · Manta · MagicPin ·
TheApplianceDirectory.

### 5. ⚠️ Check for a SECOND Google listing
The old La Vergne shop may still have its own Google Business Profile. In the GBP dashboard, search
for duplicates at the 5403 Murfreesboro Rd address. If one exists, **mark it permanently closed or
merge it** — a second Google record is far more damaging than any directory, because it is what
feeds the map pack and the AI answers.

### 6. 🎯 THE UPSTREAM FIX — data aggregators
Most small directories do not type their data, they **pull it from aggregators**. Fix only the
directories and the bad record repopulates within weeks. Submit the corrected record to:
- **Data Axle** (formerly Infogroup)
- **Localeze / Neustar**
- **Foursquare** (places data)
This is the step that makes the cleanup stick. Do it alongside, not after.

### 7. Old domain
If `tnappliancerepair.com` still resolves, 301 it to `tnapplianceexchange.net`. A live old site is an
off-site billboard for the wrong intent.

## What NOT to do
- Do not create new listings before claiming the old ones — that makes duplicates, which is the one
  thing worse than a wrong category.
- Do not mark Yelp/BBB closed unless a current listing already exists there.
