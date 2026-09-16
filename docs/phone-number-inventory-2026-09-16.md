# Phone number inventory — every line we own, where it's published, what it's for
**2026-09-16.** Teddy: *"we have 15 or 16 phone numbers and we really don't need that many… get an actual gauge for everything… we've got too many possibilities happening right now."*

**It is 20, not 15-16.** Read live off Telnyx (`telnyx-provision action=numbers/routes/numinfo/messaging/tendlc`) and cross-referenced against a repo-wide grep of ~1,400 pages + every Netlify function + colony agent. Nothing below is from memory or from this changelog — every row was measured today.

---

## The one-page answer

| | count | monthly |
|---|---|---|
| **Owned DIDs** | **20** (18 local + 2 toll-free) | ~$20 in DID rent, plus per-minute + 10DLC |
| Actually published to customers | **7** | load-bearing, do not touch |
| Internal plumbing (SMS lanes, ring groups) | **7** | load-bearing, do not touch |
| **Dead weight** | **6** | ~$6/mo + the confusion |
| Numbers still in our CODE that we do **not** own | **5** | a call placed from one of these fails |

**So the real "rein it in" number is 4-6 releases, not 10.** The sprawl Teddy is feeling is less about DID count and more about **two genuine defects** (below) plus **five ghost numbers hard-coded into live functions**.

---

## 🔴 Two real defects found while counting

### 1. Baton Rouge — 209 published pages point at a line that does NOT reach Ann
`+1 225-605-1234` is published on **209 root pages** (every `*-baton-rouge.html`, `*-denham-springs.html`, `*-gonzales.html`, `*-walker.html`, `*-pumpkin-center.html`) and carried in the JSON-LD `telephone` on 384 of them. Its voice connection is **`Ant Verify Line`** — a stray TeXML app left behind by a `&verify=1` run — **not** `ai-assistant-4bb2b942…` (Ann). Every other published number routes to Ann; this one doesn't.

CLAUDE.md flagged this stray app on 2026-09-15 as an aside. It is still there, and it is sitting under our entire Baton Rouge SEO footprint.

**Fix:** one call — `telnyx-provision?action=setai&num=+12256051234` (or repoint the DID at connection `3025024692160300548`). Verify by dialing it.

### 2. Our most-published number's texts are being dropped
`+1 888-268-8998` is **the single most-published number we have** — 787 files, **1,548 `tel:` links**, present in every language directory (`es/ ru/ fr/ vi/ zh/ hi/ ar/`) and in 612 JSON-LD `telephone` fields. Telnyx reports it **SMS-enabled but NOT assigned to the 10DLC campaign** → *"texts get dropped."*

Same for `+1 615-637-1100`, but that one is published nowhere so it costs nothing.

**Fix:** assign `+18882688998` to campaign `4b30019e-2bf8-9dd9-a768-50281e862567` in Telnyx (the brand `TN Appliance Exchange LLC` is already VERIFIED). Until then, never send a customer text from the toll-free — the carrier accepts it and silently drops it.

---

## The 20 numbers

### Group A — PUBLISHED to customers (7). Do not touch.

| Number | Routes to | 10DLC | Root pages | tel: links | What it is |
|---|---|---|---|---|---|
| **+1 629-272-1234** | Ann ✅ | ✅ | **610** | **1,088** | **THE main line.** GBP primary phone. Homepage, `appliance-ai`, `always-open`, `about`, every TN lander. |
| **+1 888-268-8998** | Ann ✅ | ❌ **dropped** | 5 | **1,548** | Toll-free. Every language dir + `/fix/` + `/repair/` + `/brands/`. |
| +1 866-268-0111 | Ann ✅ | no SMS | 423 | 17 | Toll-free #2 (ANT-0111). |
| +1 504-370-1234 | Ann ✅ | ✅ | 296 | 237 | New Orleans / South Shore. |
| +1 985-268-1234 | Ann ✅ | ✅ | 293 | 322 | North Shore LA. |
| **+1 225-605-1234** | ⚠️ **Ant Verify Line** | ✅ | 209 | 230 | Baton Rouge. **Defect #1 above.** |
| +1 931-655-1100 | Ann ✅ | ✅ | 42 | 46 | Clarksville. |

> **The per-metro `-1234` numbers are REAL and intentional.** A prior session wrongly called them placeholders and normalized 1,353 pages before reverting. They are live, they route to Ann, they carry the local-SEO signal. **Never bulk-normalize them.**

### Group B — OPERATIONAL plumbing (7). Not customer-published; all load-bearing.

| Number | Routes to | 10DLC | Refs | Role |
|---|---|---|---|---|
| +1 615-588-9500 | Ann ✅ | ✅ | 51 | **AI→customer SMS lane.** `send_link`, every Ann-sent link. |
| +1 615-857-8800 | Ann ✅ | ✅ | 45 | **Human→customer SMS lane.** Office + tech replies. |
| +1 615-757-5500 | Ant Warranty Desk | ✅ | 9 | **System→tech SMS lane.** |
| +1 615-588-9591 | Ant Office Ring Group | — | 7 | Transfer target — rings Sofia → Danielle → Teddy. |
| +1 615-280-2949 | Ann ✅ | ✅ | 66 | The historic main line. **0 web pages** now, but 66 code/doc refs + it is what LSA and old business cards carry. |
| +1 615-845-8500 | Ann ✅ | ✅ | 11 | Google Ads call extension (ads attribution). |
| +1 615-821-1400 | Ann ✅ | no SMS | 4 | Warranty-desk inbound (`?order=warranty`). |

### Group C — DEAD WEIGHT (6). This is the "rein it in" list.

| Number | Routes to | Published | Verdict |
|---|---|---|---|
| **+1 615-637-1100** | Ann | **0 files anywhere** | **RELEASE.** Paying for a number nobody can reach, and its texts would drop anyway (not in 10DLC). |
| **+1 225-545-1100** | unknown conn | **0 files anywhere** | **RELEASE.** Registered for 10DLC, published nowhere. |
| **+1 804-606-1234** | Ant — The Appliance Guy (trial) | 2 code refs | **RELEASE.** TK's tenant is purged — only `demo` and `tn-appliance-exchange-llc` exist. Orphan. |
| **+1 931-632-4734** | Ant — Classic Automotive (trial) | 4 code refs | **Teddy's call.** Greg's tenant is purged, but Greg is a real friend/prospect. Still billing. |
| +1 615-588-9400 | Ant — Joey's Appliance Repair (trial) | 8 code refs | **Teddy's call.** `demo` tenant still exists; this is the sales-demo line. Keep only if the demo still gets shown. |
| +1 615-235-9256 | **Ann — TN Appliance Exchange LLC** (platform) | 2 code refs | **Teddy's call.** Bought by mistake today. It is the dual-feed test line in `docs/phone-cutover-plan-2026-09-16.md`, or `action=release`. |

**Releasing a DID is irreversible.** Nothing below gets released without Teddy saying so.

---

## 🧟 Five numbers we DON'T own that are still in live code

Released in the 2026-06 Vapi era and never scrubbed: **629-260-7111 · 629-247-7111 · 731-503-1142 · 504-380-0975 · 504-355-9111**.

They appear in two very different roles. **Only one role is harmful — do not bulk-scrub all of them.**

### Harmless (leave alone): "is this one of our own numbers?" allowlists
A stale entry here is inert — it only ever means *"if this number calls in, don't treat it as a fresh customer lead."*

- `vapi-tool.js:26` — `SHOP_DIGITS`
- `office-texml.js:200` — `SHOP_DIDS`
- `new-lead-alert.js:94` — internal-number skip list

Removing these buys nothing and risks re-introducing a false "new cash lead" alert if a released number is ever re-issued to someone else. **Leave them.**

### 🔴 Harmful (2 live dial targets that go nowhere)

| File | Line | What it does | Why it's dead |
|---|---|---|---|
| `netlify/functions/inbound-call-webhook.js` | 33 | `TRANSFER_TO = '+16292607111'` — a **live transfer destination** | We don't own it. Any call transferred down this path lands nowhere. |
| `colony-loop/vapi-out.js` | 102, 112, 113 | `TN_PRIMARY` / `TN_FALLBACK_VAPI` / `LA_FALLBACK_VAPI` — **dial-FROM** ids | Vapi phone-number ids for numbers we released. Any outbound call placed from them fails. |

**Blast radius is small today:** both sit on the retired Vapi path (the live stack is Telnyx→Ann), and the colony loop has been dormant (`loop_tick` = 0 over 3 days). But they are live code pointing at phones that no longer exist, and they are exactly the "too many possibilities" Teddy is feeling — the codebase still believes in a phone system we decommissioned.

---

## ✅ Three false alarms — do NOT touch these

| Looks like | Actually |
|---|---|
| `813-310-9901` (104 files) | **Melissa's real-estate site** (`melissa-wood/`). Different business, different domain. Standing rule: never sweep that directory. |
| `615-457-3171` (10 tel: links) | **Brandon Pack's Music City Aquatics** site (`sites/music-city-aquatics/`). Another tenant. |
| `551-993-5455` | **Not a phone number.** It is a substring of the video filename `755199354557734` (`fbarch-755199354557734.mp4`). Exactly the false-positive class that caused the 2026-07-22 revert. |

**And the standing rule is holding:** Teddy's cell `615-485-5795` appears in **zero** customer-facing HTML.

---

## 📌 Correction to the canonical NAP in CLAUDE.md

CLAUDE.md's **CANONICAL NAP** block says `615-280-2949`. Measured live today:

- **Google Business Profile primary phone = `(629) 272-1234`**
- 610 root pages + 1,088 `tel:` links + 574 JSON-LD `telephone` fields also say `629-272-1234`

`615-280-2949` is on **zero** web pages. The canonical block is stale — and dangerous, because the next citation cleanup would "fix" 600+ pages to a number GBP does not list, breaking NAP consistency in the exact way the aggregator work was meant to repair.

**Canonical NAP should read `629-272-1234`.** (615-280-2949 stays alive as the historic line LSA and printed material carry — it just isn't the published one.)

---

## Recommended order of operations

1. **Fix Baton Rouge routing** (`setai` on +12256051234) — 209 published pages currently miss Ann. *Free, one call, highest impact.*
2. **Add +18882688998 to the 10DLC campaign** — our most-published number can't text. *Free, Telnyx portal.*
3. **Repoint the 2 dead dial targets** — `inbound-call-webhook.js:33` and `colony-loop/vapi-out.js:102/112/113`. **Leave the allowlists alone.** *Code-only, no carrier action.*
4. **Correct the canonical NAP** to 629-272-1234 in CLAUDE.md.
5. **Release the 2 clear orphans** (615-637-1100, 225-545-1100) — zero reach, zero refs. *Teddy's word.*
6. **Decide the 4 judgment calls** (804-606-1234, 931-632-4734, 615-588-9400, 615-235-9256).

Steps 1-4 are safe and reversible. Steps 5-6 are irreversible and wait on Teddy.
