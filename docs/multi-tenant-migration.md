# Multi-Tenant Migration Plan

Current state after V3 Tasks 1-21 (2026-05-27):
- `company` table + `company_settings` table exist
- `company_id` column added to: customer, jobs, technicians, tech_earnings, technician_decision_report, tech_assist_session (all default 1)
- `onboard_company`, `get_company_settings`, `set_company_setting`, `get_active_techs_count` endpoints live
- `signup.html`, `company-admin.html` live
- `colony-loop/config.companyId` + sms.js passes company_id in context
- New Netlify function `create-tenant-subscription` for Stripe per-tenant billing

## What still needs to happen (deferred from V3 Tasks 22-30)

### Producer endpoints — accept company_id at intake

All endpoints that CREATE rows in `customer/jobs/technicians` need to accept `company_id` in input and persist it. Today they all silently use the default (1). For multi-tenant:

- `create_job_from_chat_POST` — add `company_id` input
- `hcp_job_webhook_POST` — derive `company_id` from settings lookup (HCP has no concept of tenants; the webhook is currently TN-only)
- `ahs_email_intake_POST` — derive `company_id` from inbox owner (similar to HCP — single email gateway per tenant)
- `servicepower_email_intake_POST` — same
- `book_appointment_from_office_POST` — add `company_id` input
- `onboard_tech_POST` — add `company_id` input

### Consumer endpoints — filter by company_id

All endpoints that READ multiple rows need a `company_id` filter:

- `get_office_calendar_week_GET` — already added company_id column on jobs/technicians, now filter the queries
- `get_office_pulse_GET` — filter event_log by company_id (deferred until event_log column added)
- `get_office_todo_GET` — same
- `get_tech_daily_dashboard_GET` — filter by tech.company_id
- `get_tech_performance_GET` — same
- `search_customers_POST` — filter
- `get_tech_leaderboard_GET` — filter
- `get_unpaid_self_pay_jobs_GET` — filter
- (~30 more total)

### Runtime refactors

- `send_sms_POST` — read FROM numbers from company.telnyx_from_* instead of env vars (sms.js already passes company_id in context)
- `tick.js` — read tenant timezone from company settings instead of hardcoded CT
- Most daily scheduled emits — loop through active companies, emit per-company signal

### Cross-tenant aggregation (the data flywheel)

These power the network effect. Anonymized aggregation across all companies:

- `cross_tenant_parts_catalog_GET` — most-used parts per appliance type
- `cross_tenant_failure_modes_GET` — common failure modes per (brand, model)
- `cross_tenant_brand_reliability_GET` — first-visit-fix rate per brand across all techs

These views power the predictive failure layer and give every tenant immediate value from the collective data.

## Cutover sequence (when 2nd tenant signs up)

1. New tenant signs up via signup.html → company_id=2 created
2. Tenant operator gets welcome SMS with admin URL
3. Tenant uses company-admin.html to set their Telnyx FROM numbers, owner phones, branding
4. Tenant onboards first tech via tech-onboard.html?company_id=2
5. Tenant starts taking calls/jobs — all data scoped to company_id=2

## Risk mitigations

- Existing TN Appliance data is safe — all rows default to company_id=1
- New tenant data is fully isolated by company_id
- Cross-tenant aggregation is opt-in via separate endpoints (no accidental leakage)
- Operator can disable a tenant via company.tenant_status='suspended'

## Estimated work to complete

- Producer endpoints: 6 files × ~10 min each = 1 hour
- Consumer endpoints: 30 files × ~5 min each = 2.5 hours
- send_sms refactor: 1 hour (critical path, needs testing)
- tick.js timezone refactor: 30 min
- Cross-tenant aggregation endpoints: 3 endpoints × 30 min = 1.5 hours

**Total: ~6 hours of focused work** to complete multi-tenant. Best done in one or two dedicated sessions, NOT scattered across other work.
