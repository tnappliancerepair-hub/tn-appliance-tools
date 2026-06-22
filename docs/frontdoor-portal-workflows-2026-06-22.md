# Frontdoor / AHS Contractor Portal — Danielle's Domain (canonical spec)

**Captured 2026-06-22** from the four official Frontdoor Contractor Training guides Teddy
pasted + the live Dispatch Activity Report screenshot. This is the blueprint every
Frontdoor automation reads from. Portal: **`contractor.frontdoorhome.com`**.

> **Why this matters:** AHS/Frontdoor warranty has been ~95% of the business for years —
> "the foundation." Every one of these four workflows is a **manual portal task Danielle
> runs by hand**, and each one is a place where money leaks if it stalls or is sloppy.
> "Business has been steadily falling daily" traces to throughput here: dispatches piling
> up unscheduled → AHS escalates/pulls them; finished jobs not invoiced → no payment;
> uninstalled parts not returned → AHS deducts from our account.

## TN Appliance Frontdoor identity
- **Vendor IDs:** `822218`, `822418`, `839828` (from the Dispatch Activity Report).
- Field Manager (Appliance): **877-433-3841**.
- SmartAutho/SmartPart support: **SmartAuthoSupport@frontdoorhome.com**.
- Portal issues: **contractorportal@frontdoor.com**.
- Part returns: **AHS_Purchasing_Part_Returns@ahs.com** + the Appliance Part Return Form.

## The money loop (order is mandatory)
```
Dispatch received  →  schedule fast (or AHS escalates/pulls)
   →  tech diagnoses
   →  ① SmartAutho estimate submitted   (get authorization + repair credit)
   →  ② SmartPart order submitted        (parts ordered / shipped to customer or truck)
   →  parts arrive, tech completes repair
   →  ③ Invoice submitted                (THIS is how we get paid → status Approved)
   →  ④ Part Return (only if appliance replaced / part defective/damaged/mis-picked)
```
**Hard rule (from SmartAutho Quick Tips):** *"the job has already been invoiced and cannot
be authorized."* Authorization must come BEFORE invoicing. Never invoice a job that still
needs autho.

---

## ① SmartAutho (authorization / estimate) — *before the repair*
Actions → **View / Edit Authorization** on any *In Progress* job. Sections, in order:

| Section | Field | Our source field |
|---|---|---|
| Item Details | Item (appliance) | `appliance_type` |
| | Upload pics/docs/video (PDF/DOC/XLS/TXT/JPEG/JPG/MP4/AVI/MOV) | job attachments (customer + tech media) |
| | Recommend Replacing Item (appliances) | TDR disposition = "not worth fixing" |
| Diagnosis | **What's the problem?** | `tdr_diagnosis` / `problem_summary` |
| | Additional Information | TDR notes |
| Jobs | Job type: **Replace Part / Replace Item / Labor-Only / No Work Needed (LTD only)** | derive from TDR disposition |
| | Failed component (typeahead) / Failed Part (free text) | `tdr_failed_component` |
| | **Failure Reason** (dropdown; "Not Covered" option) | `tdr_failure_cause` |
| | What effect does this failed part have on the item? | compose from diagnosis |
| | What needs to be done to fix the issue? | `tdr_repair_completed` / recommended |
| Job Line Items | Type of job (Repair Only / mod / code) | default Repair Only |
| | Supplied By (You / AHS Supply / Direct Supply / Labor-only) | default "You supply" |
| | **Part #** (+ "Part Number Unknown" → model+brand required) | `verified_part_number` (+ `model_number`,`brand`) |
| | **Cost** (per-unit part cost) | parts cost *(thin in our data)* |
| | **Quantity** | parts qty |
| | Part Description (pre-fills; refine, e.g. "right front burner") | `failed_component` / part name |
| | **Labor** (Hourly: hours × auto rate, or Flat) — include diagnosis labor | `tdr_labor_hours` *(thin)* |
| Labor-to-Date | Cost to diagnose the item (hourly or flat) | diagnostic labor |
| Est. Completion & Taxes | Estimated Completion Date | parts ETA / scheduled revisit |
| | Taxes | computed by region (TN 9.75% / LA 9.45%) |
| Submit | **Submit Estimate** (green check per item required) | — |

Notes: multi-item dispatches submit in ONE form. NCC (non-covered charges) flow asks
"are you at the customer's home?" for prioritized phone authorization. Auto-approval +
automatic part ordering possible for appliances.

## ② SmartPart (parts ordering) — *In Progress*
Actions → **Order Parts** (or Dispatch ID → Order Parts). Requires Field-Manager-granted
access. Sections:

| Field | Our source |
|---|---|
| Item (blank by default for Cooktop/Range, Microwave, Oven) | `appliance_type` |
| Item Details (+ upload, e.g. tag number) | model/serial + attachments |
| Failed part (typeahead) | `tdr_failed_component` |
| **Part #** | `verified_part_number` |
| **Quantity** | qty |
| Part Description (pre-fills; edit) | part name |
| Additional Notes | TDR notes |
| **Shipped To** (customer / truck) | drop-ship-to-customer default (see parts model doc) |
| Truck Stock (replenish) | off unless restock |
| Labor Type (install labor) | `tdr_labor_hours` |
| Labor-to-Date (hourly/flat) | diagnostic labor |
| **Purchase Parts / Submit Part Request** | — |

Parts auto-order when possible; otherwise "submitted for review." Tracking lives under
Dispatch Details → **Parts/Equipment** tab (Carrier / Ordered Parts / Order History).

## ③ Invoicing — *after completion → THIS is how we get paid*
Invoices tab → **Ready To Invoice** → search Dispatch ID → **Create Invoice**:

| Field | Our source |
|---|---|
| **Dispatch ID** | `claim_number` / `dispatch_id` |
| **Contact Date & Time** (mm/dd/yyyy) | first contact / scheduled date |
| **Serviced Date & Time** | `job_completed_at` |
| Contractor Complete / Customer Complete (radio) | default Contractor Complete |
| **Work Performed** (prose AHS reviewers read) | **composed narrative** from diagnosis + failed component + cause + repair + parts |
| **Invoice ID** (unique alphanumeric, one per dispatch) | **generated:** `TN-<dispatchID>` |
| **Parts, Labor & Tax** (Discount auto-calcs quick-pay) | parts $ / labor $ / tax *(thin → fill-in)* |
| **Create Invoice → Submit Invoice** (auto-submits to AHS) | — |

Statuses: **Approved** (= payment received) · **Disputed** (auto quick-pay discount applied;
can dispute via Dispute Reason → AHS Invoice Control Team). Second invoice via "add another
invoice" when first+second ≤ authorized. Submitted Invoices searchable by Dispatch ID /
Vendor ID / date range; Download gives ~1-day-post-payment paid detail.

## ④ Appliance Part Returns — *money protection*
Trigger: AHS decides to **replace** the appliance (uninstalled parts must be returned) OR a
part arrives **defective / damaged / mis-picked**.
- Submit the **Appliance Part Return Form** immediately; email photos (part, box+label,
  damage) + **model & serial** to **AHS_Purchasing_Part_Returns@ahs.com**.
- **Damaged parts: report within 5 days of delivery** (supplier window) or no credit.
- Miss this → **AHS deducts the part cost from our account.**
- Our trigger data: TDR **"📦 Parts to return"** (`tdr.parts_not_used`) + any "replace
  appliance" disposition.

---

## What Ant already knows vs. what's missing (the automation gap)
**We have (pre-fillable now):** vendor + dispatch/claim #, customer, address, appliance,
brand, model, serial, problem, diagnosis, failed component, failure cause, verified part #,
parts used, parts to return, tech.
**We're thin on (must stay fill-in / fix upstream):** labor hours, repair-completed prose,
per-unit parts cost, tax, exact contact/serviced timestamps. Root cause: **TDRs aren't being
completed** by techs — the same upstream gap that slows everything. Every Frontdoor card
should surface "⚠️ missing: labor hrs / repair notes" so Danielle (or Ant) chases the tech.

## Automation roadmap (build order)
1. **Invoice-Ready queue** (③) — completed jobs, composed Work Performed + generated Invoice
   ID + dispatch ID + dates, one-tap copy, "open portal," "mark invoiced." *(building now)*
2. **Authorize-Ready** (①) + **Part-Order-Ready** (②) tabs — same composer, In-Progress jobs.
3. **Part-Return watch** (④) — flag jobs with parts-to-return / replace-appliance; prep the
   return form fields + photo email; 5-day timer.
4. **API push** (when Developer-Portal token vaulted): Dispatch Status + Note Update so Ant
   posts status straight into the portal — removes Danielle's manual status updates entirely.
