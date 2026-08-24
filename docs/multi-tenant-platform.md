# The Multi-Tenant Platform — a scalable database for the masses

Status: **architecture v1 (2026-08-24, Teddy: "wide, and make it happen").** The starter
schema + RLS policies live in `docs/sql/004_multitenant_core.sql` (runnable in the Supabase
SQL editor). This is the SPINE the sellable "database" product is built on — the tier above
the phones (Ann).

> This SUPERSEDES the retrofit approach in `docs/multi-tenant-migration.md` (bolt `company_id`
> onto ~700 XanoScript endpoints). That path is fragile — Xano can't enforce tenant isolation
> at the database, so one missed filter across 700 hand-written endpoints leaks Shop A's data to
> Shop B. For a product used by the masses that's an unacceptable, trust-ending risk. We build
> the multi-tenant core FRESH on the substrate that enforces isolation for us.

## The honest starting truth

The Xano workspace + Mac-Mini colony loop that runs TN Appliance is a phenomenal **proving
ground for one shop**, but it's the wrong substrate to scale a database to many shops:

1. **Xano can't stop a tenant leak.** No row-level security — isolation would be discipline-based
   across ~700 XanoScript endpoints. One slip = cross-tenant data exposure.
2. **We already hit Xano's compute ceiling at ONE shop's volume** (board N+1, 15s freezes).
   Stacking hundreds of tenants on that workspace makes it worse.
3. **The Mac Mini is a single box in one location** — a SPOF no multi-shop product can sit on.

So "scalable for the masses" = **a true multi-tenant data layer, built once on the right
foundation.** We already own that foundation: **Supabase** (the ANT OPS Postgres project).

## Why Supabase is the substrate

Supabase = Postgres + Auth + **Row-Level Security (RLS)** + auto-generated API + Realtime. It
hands us, natively, the exact multi-tenant machinery Xano lacks:

- **RLS** — the *database itself* refuses to return another shop's rows. Even a buggy query can't
  leak across tenants. This is the single thing that makes "for the masses" safe.
- **Auth + JWT** — every user belongs to a company; the tenant is resolved from the login token,
  never a URL/param a user could tamper with.
- **Realtime** — the live office board (cards moving without a refresh) is built in.
- **PostgREST** — an instant REST API over the tables; we stop hand-writing fragile XS endpoints.
- **Service role** — the backend / provisioning / the Ann-lead writer / the loop bypass RLS to
  act across tenants where legitimately needed.

## The 5 decisions that make it scale

1. **Shared schema, row-level tenancy.** ONE database, every row stamped `company_id (uuid)`,
   RLS enforcing it. This is how Stripe/Shopify scale to millions. (DB-per-tenant stays in the
   back pocket ONLY for a big white-label client, e.g. a warranty company.)
2. **Tenant comes from the token, never a parameter.** Resolved server-side via
   `current_company_id()` (reads the logged-in user's membership). Un-bypassable by design.
3. **Per-tenant CONFIG, never per-tenant CODE.** Everything a shop customizes — name, price book,
   hours, services, their Ann persona, which features they bought — lives in DATA
   (`company.settings`, `company.features`). The moment we fork code for one shop, scaling dies.
   **This is the non-negotiable.**
4. **A trade-agnostic core.** TN + Joey = appliances; Greg = vehicles (VIN/year/make/model, not
   model#/serial). The schema is WIDE: a generic `unit` (the thing being serviced) whose
   trade-specific fields live in a `jsonb` `attributes`, described by a `trade_profile`. Appliance
   and automotive are the first two profiles; plumbing / HVAC / locksmith / pool / etc. are each a
   new profile ROW, never a schema fork.
5. **Self-serve, instant provisioning.** Sign up → `create_company_with_owner(...)` seeds a tenant
   + owner in one call → live in minutes. Provisioning is a FUNCTION, not a project. (Hand-
   provisioning each shop is the money-loser.)

## The MVP is ~9 objects, not all of Ant

The masses need the core a shop runs on — not the whole 700-endpoint machine:

| Object | What it is |
|---|---|
| `company` | the tenant — name, trade, plan, `features` (entitlements), `settings`, timezone |
| `app_user` | a login — belongs to a company, role owner/office/tech, maps to Supabase auth |
| `customer` | the homeowner / vehicle owner |
| `unit` | **the thing serviced** — trade-agnostic asset (appliance, vehicle, …) via `attributes` jsonb |
| `technician` | a tech (optionally linked to an `app_user`) |
| `job` | the work — status board, schedule, assigned tech, problem, source |
| `invoice` + `invoice_line` | billing — labor / parts / fees, paid state |
| `thread_message` | the lead/conversation thread — ties straight into Ann |
| `event` | scoped audit/event log |
| `trade_profile` | **global** (not tenant-scoped) — defines each trade's unit fields + vocabulary |

Warranty-claim automation, parts sourcing, HCP sync — those are TN-specific **power tiers** you
upsell later, not the core product.

## The isolation model (RLS)

- `current_company_id()` — `SECURITY DEFINER STABLE`, returns the logged-in user's `company_id`
  by reading `app_user` for `auth.uid()`. Because it's `DEFINER` it bypasses RLS to do the lookup.
- Every tenant table: `ENABLE ROW LEVEL SECURITY` + policies
  `USING (company_id = current_company_id())` (read) and
  `WITH CHECK (company_id = current_company_id())` (write).
- `anon` gets nothing (no grants); `authenticated` is fully RLS-gated; `service_role` bypasses RLS
  for the backend/loop/provisioning.
- **Intra-tenant role scoping** (a tech sees only their own jobs) is a second, thinner layer of
  policy on top — the starter SQL ships tenant isolation fully and includes ONE worked example
  (tech-scoped jobs) to extend from.

## How it funds itself (sequencing)

| | Build cost | When |
|---|---|---|
| **Phones (Ann)** | cheap — already multi-tenant (each shop = a config entry, no shared DB) | **sell now, to everyone** |
| **Database platform** | the one heavy build (this doc) | **build once, right — funded by phone revenue + validated demand** |

- **TN Appliance = tenant #1.** It migrates onto the new core in SHADOW (both systems running,
  verified equal on real traffic) before anything flips. Nothing about live TN ops changes until
  the shadow proves out.
- **Joey's shop = tenant #2** — the forcing function that keeps the core honestly generic.
- Phones bring shops in the door and pay the bills while the real database gets built ONCE.

## Migration discipline (TN onto the new core)

1. Stand up the schema (`004_multitenant_core.sql`) in a dedicated Supabase project.
2. Dual-write / backfill TN's Xano data into the new tables as `company_id = <TN uuid>`.
3. Shadow-verify: read the same job/customer/board from both, diff on real traffic, prove equal.
4. Flip reads one surface at a time (board → scheduling → customers → invoicing), Xano as hot
   rollback the entire time.
5. Xano is decommissioned LAST, per-subsystem, never big-bang.

## What is explicitly NOT in scope for the core

- Warranty claim submission / ServicePower / AHS (TN power-tier).
- Parts sourcing / Marcone / Amazon drop-ship (TN power-tier).
- HCP sync (TN legacy bridge, retiring).
- The colony-loop's 300 agents — the core is the DATA + a thin API + the front-end; automation
  agents that are genuinely cross-tenant get rebuilt cloud-side later, not lifted from the Mac.

## Open questions to lock next

1. **Auth:** Supabase Auth for all three roles (owner/office/tech), or a lighter tech access
   (magic-link / PIN) that maps to an `app_user` without a full password login? (Leaning: Supabase
   Auth for owner/office, a PIN/magic-link tech path that still resolves to an `app_user`.)
2. **Realtime board:** lean on Supabase Realtime for live board updates, or keep polling for v1?
3. **Billing:** Stripe subscription drives `company.features` (the check/uncheck configurator maps
   1:1 to the feature flags). Wire at provisioning or after first value?
4. **Cross-tenant flywheel:** the anonymized aggregate views (parts, failure modes, brand
   reliability) that give every tenant value from the collective data — build as `SECURITY DEFINER`
   views over all tenants once there are ≥3 shops.

## Changelog
- 2026-08-24 — v1. Architecture + starter schema (`004_multitenant_core.sql`). Direction set to
  WIDE (trade-agnostic) + Supabase-native RLS, superseding the Xano-retrofit plan. (Teddy)
