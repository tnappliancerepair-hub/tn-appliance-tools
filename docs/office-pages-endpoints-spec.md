# Office Pages — Backing Endpoints (drafts for xano-mcp validation)

These three endpoints are what stand between the four deployed office pages and
real data. Written against the page contracts (those are exact). **Table/field
names and a few syntax details are assumptions — validate via xano-mcp and fix
against the real schema before publishing.**

Page → endpoint status:

| Page | Endpoint | Status |
|---|---|---|
| office-kanban | `get_office_kanban` | exists (Tier 1 paste #3) — confirm shape matches deployed page |
| warranty-submission-dashboard | `list_jobs_by_status?status=ready_warranty` (list) | Tier 5 — exists/queued |
| warranty-submission-dashboard | `mark_warranty_submitted` (write) | **NEW — below (#1)** |
| tech-adoption-tracker | `get_tech_adoption` | **NEW — below (#2)** |
| customer-portal-share | `search_customers` | **NEW — below (#3)** |
| customer-portal-share | `send_sms` (#32) | exists |

---

## ⚠️ Cross-cutting consistency (read first)

The status string literals MUST be identical across three places or jobs will
silently fall out of the warranty flow:

1. The list endpoint filter: `status == "ready_warranty"`
2. The write endpoint (#1) sets submitted → `"warranty_submitted"`, undo → `"ready_warranty"`
3. The kanban `STATUS_MAP` in office-kanban.html buckets both of these

Pick the canonical strings once. If your jobs table already uses different status
values (e.g. `tdr_complete`, `submitted`), use those everywhere and update the page
configs to match — don't introduce new ones.

---

## 1. `mark_warranty_submitted` (POST)

**Contract** — warranty-submission-dashboard sends:
```json
{ "job_id": 123, "submitted": true }
```
`submitted:true` = mark submitted; `submitted:false` = undo. Page reads back nothing
critical, but returning the new status lets it reconcile on the next poll.

**Assumptions to confirm:** jobs table is `job`; status field is `status`; the two
literal values above.

```
input {
  int job_id
  bool submitted
}

// choose target status from the flag
var target_status = "ready_warranty"
conditional ($input.submitted == true) {
  var.update target_status = "warranty_submitted"
}

db.edit job {
  field_name = "id"
  field_value = $input.job_id
  data: {
    status: $var.target_status
  }
} as updated_job

response {
  success: true
  job_id: $input.job_id
  status: $var.target_status
}
```

---

## 2. `get_tech_adoption` (GET)

**Contract** — tech-adoption-tracker expects:
```json
{ "techs": [
  { "tech_id": 2, "used_24h": 3, "used_7d": 11, "last_used_at": "2026-05-30T14:02:00Z" },
  ...
] }
```
Missing techs are fine — the page fills the roster and shows them as cold/zero.

**Assumptions to confirm:** source table `tech_assist_session` (ID 29) has `tech_id`
and `created_at`; timestamp math is in ms since epoch (adjust the cutoff constants
if Xano uses seconds). Aggregation is done in-code (no SQL group-by) to stay within
the XS rules — **this is the least certain block; expect to rework the accumulator
syntax against the dialect.**

```
input { }

var now_ts = now
var cutoff_7d  = $var.now_ts - 604800000
var cutoff_24h = $var.now_ts - 86400000

db.query tech_assist_session {
  where: created_at >= $var.cutoff_7d
} as sessions

// accumulate per tech_id in an object
var acc = {}

foreach ($var.sessions as session) {
  var tid = $session.tech_id

  conditional ($var.acc[$var.tid] == null) {
    var.update acc[$var.tid] = {
      tech_id: $var.tid,
      used_24h: 0,
      used_7d: 0,
      last_used_at: null
    }
  }

  var.update acc[$var.tid].used_7d = $var.acc[$var.tid].used_7d + 1

  conditional ($session.created_at >= $var.cutoff_24h) {
    var.update acc[$var.tid].used_24h = $var.acc[$var.tid].used_24h + 1
  }

  conditional ($session.created_at > $var.acc[$var.tid].last_used_at) {
    var.update acc[$var.tid].last_used_at = $session.created_at
  }
}

// object -> array
var techs = []
foreach ($var.acc as key, row) {
  var.update techs = $var.techs + [$row]
}

response {
  techs: $var.techs
}
```

If in-code aggregation fights the dialect, the fallback is: one `db.query` with a
24h `where` (count = used_24h) and a second with a 7d `where` (count = used_7d),
joined per tech — more queries, simpler syntax.

---

## 3. `search_customers` (GET)

**Contract** — customer-portal-share calls `?q=<term>` and expects:
```json
{ "customers": [
  { "job_id": 123, "customer_id": 45, "customer_name": "Jane Doe",
    "phone": "6155551234", "address": "12 Oak St", "city": "Antioch" },
  ...
] }
```
The page builds the portal link from `job_id` (or `customer_id` fallback) and texts
`phone`. Records with no phone are shown but their send button is disabled.

**Assumptions to confirm:** searching the `job` table (denormalized customer fields)
is acceptable; field names `customer_name`, `customer_phone`, `address`, `city`,
`customer_id`. If you have a dedicated customers table, point the query there
instead. Case-insensitive contains shown as `ILIKE` — confirm the operator your
dialect uses.

```
input {
  text q? filters=trim
}

db.query job {
  where: (customer_name ILIKE "%" ~ $input.q ~ "%")
      OR (customer_phone ILIKE "%" ~ $input.q ~ "%")
      OR (address ILIKE "%" ~ $input.q ~ "%")
  sort: created_at desc
  limit: 25
} as rows

var customers = []
foreach ($var.rows as r) {
  var.update customers = $var.customers + [{
    job_id: $r.id,
    customer_id: $r.customer_id,
    customer_name: $r.customer_name,
    phone: $r.customer_phone,
    address: $r.address,
    city: $r.city
  }]
}

response {
  customers: $var.customers
}
```

---

## Notes
- No em-dashes, no try/catch, conditional blocks (not raw `if`), `foreach`
  each-as, `var.update` for mutations — written to those rules, but the dialect
  specifics (object indexing by var key, string concat operator, `db.edit`
  field selector) are the parts most likely to need correction.
- Validate each via xano-mcp before publishing.
- After publishing: set `OFFICE_PASS` in all four pages, and align each page's
  endpoint constant if you renamed anything here.
