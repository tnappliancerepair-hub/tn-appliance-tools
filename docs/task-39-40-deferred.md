# Tasks 39 + 40 — deferred (need real samples + API access)

## Task 39: Email-intake adapter generator

**Goal:** pattern that lets new vendor emails (Choice, Sears, etc) be parsed without code changes.

**Why deferred:** need real Choice / Sears / new-vendor email samples to build the parser. Today AHS + ServicePower email adapters live in:
- `api/intake/ahs_email_intake_POST.xs`
- `api/intake/servicepower_email_intake_POST.xs`

**Approach when samples arrive:**
1. Generic `vendor_email_template` JSON config (regex patterns per field)
2. Generic `parse_vendor_email_POST` XS endpoint that takes raw email + template id, returns structured fields
3. New `vendor_email_templates` Xano table for the configs (no code change per vendor)

**Operator action:** forward 3-5 real emails per new vendor to tnappliancerepair@gmail.com with subject `[ant-email-sample] <vendor>`. Build can resume from there.

## Task 40: Auto-create HCP appointment from Ant-source jobs

**Goal:** legacy bridge — Ant-created jobs auto-sync TO HCP (currently HCP is canonical, Ant pulls from it).

**Why deferred:** This is throwaway code (per CLAUDE.md strategic pivot 2026-05-25) that retires on HCP cutover Saturday. Don't invest engineering time in a 1-week bridge when the prereqs are done.

**Recommendation:** SKIP this task. Cut HCP Saturday instead. The HCP cutover prereq #5 (office booking flow) is shipped, so the strategic move is to actually cut over rather than build the bridge.
