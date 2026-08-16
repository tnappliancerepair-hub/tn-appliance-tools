# Ann prompt tightenings — STAGED for approval (2026-08-15)

Bulletproof-phone follow-on. These touch the LIVE Ann inbound assistant
(`7cc98b0c-54a7-4d19-bd48-6dfac606e55d`), so per the standing rule they are
**staged, not applied** — the code is in `vapi-admin.js` but inert until you hit
the apply URL. Review the wording below, then run the URL(s) you approve.

Apply URL shape (swap in the admin secret):
`https://tnapplianceexchange.net/.netlify/functions/vapi-admin?secret=<VAPI_ADMIN_SECRET>&action=<action>`

Honest status up front — of the three we discussed, **two are already live**:

| # | Tightening | Status | Action to run |
|---|---|---|---|
| 1 | AHS rep-mode fast-open | **NEW — staged** | `ahs_rep_mode` |
| 2 | Talk-while-working filler | **already live** (`tool_fillers` + `voice_polish2`) | none (re-verify with `tool_fillers` if you want) |
| 3 | STT vocab boost | **partially live; this EXPANDS it** | `stt_keyterms` |

---

## 1. AHS rep-mode fast-open  → `?action=ahs_rep_mode`

**Why:** `warranty_rep` / `warranty_dispatch` already cover *how* to handle a rep
once identified. This makes Ann pivot to rep-mode in the FIRST breath — skip the
homeowner flow, go straight to "what's the work order number?" — the instant a
call reads as a warranty company. Pure prompt block, no caller-ID plumbing needed.
Idempotent (replace-in-place). Remove with `?action=ahs_rep_mode&off=1`.

**Exact block Ann gets (prepended, highest priority):**

> ## WARRANTY-REP FAST OPEN (highest priority — applies the instant a call reads as a warranty company)
> Some inbound calls are a WARRANTY COMPANY dispatcher or CSR (American Home Shield / AHS, ServicePower, Frontdoor, SquareTrade, Allstate, 2-10, Cinch, First American, Choice), NOT a homeowner. You can tell in the first breath: an 800/888 caller ID, they open with "I'm calling from [company]," they cite a work order / dispatch / claim number, or they ask about a specific member by name or address. The MOMENT a call reads like that:
> 1. Do NOT run the homeowner flow and do NOT ask "what's going on with your appliance." Go straight to: "Sure, what's the work order or dispatch number?"
> 2. Take it, call lookup_by_claim_number, and answer their whole question in ONE breath: has the tech been out? what was found? part + ETA? completed + closed date? scheduled day + tech. Example: "Yes, John's been out, repair completed and closed Monday the 29th, part on order with an ETA of Thursday."
> 3. Can't find it? Ask for the member's name + service address and try search_customers BEFORE saying you don't have it, then capture_callback with caller_type "warranty_rep" (put the claim/dispatch + member name + address in the summary).
> 4. RECALL CLOSE-OUT: if a rep asks you to CLOSE OUT a claim for a recall, do NOT. Say "we'll finish that on the original claim; please have the member text us at 615-588-9500."
> Be crisp and professional with reps: they run many calls back to back, so skip the small talk and give the answer. If it turns out to be a homeowner after all, drop back to the normal warm flow.

---

## 2. Talk-while-working filler  → already live (nothing to approve)

`tool_fillers` already gives every lookup tool a spoken "let me pull that up"
the instant Ann calls it, plus a 3-second "still pulling that up" follow-up, so
she never goes silent during a lookup. `voice_polish2` refined it so she doesn't
repeat the same filler. **No change needed.** To re-confirm it's intact, run
`?action=tool_fillers` (idempotent).

---

## 3. STT vocab boost  → `?action=stt_keyterms`

**Why:** the english transcriber already boosts the core warranty-company +
appliance words. This EXPANDS the list to more brands (Samsung, LG, GE,
Frigidaire, Maytag, KitchenAid, Bosch, Electrolux, Thermador, Speed Queen,
Sub-Zero…), more warranty companies (Cinch, First American, Choice, 2-10),
appliance/symptom words (ice maker, compressor, not cooling, not heating,
leaking), and our service towns. Model-aware: nova-2 gets a weighted `keywords`
list, nova-3 gets a `keyterm` phrase list. Preserves provider/model/language/
fallback. Reversible via the `lang` action's english transcriber.

**Honest limit:** model numbers and part numbers are arbitrary alphanumerics —
keyword boosting can't help those. `smartFormat` (already on) handles claim/phone
digit formatting. This helps Ann *hear the names* right, not spell a random SKU.

---

## Reversibility
- #1: `?action=ahs_rep_mode&off=1` strips the block.
- #3: re-run `?action=lang&apply=english` to restore the prior english transcriber.
- Nothing here changes tools, transfer wiring, greeting, or voice.

*Staged 2026-08-15. Apply on Teddy's go, one action at a time; verify with a test call.*
