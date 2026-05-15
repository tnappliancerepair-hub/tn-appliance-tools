# Financial-system Xano schemas — 2026-05-15

Source-of-truth copies of the XanoScript files that ship the Phase 1
(tables) and Phase 2 (endpoints) financial-system build. Mirrored here
because `xano-workspace/` is gitignored team-wide (some pre-existing
files in that dir carry secrets; the directory ban is a defense-in-depth
choice — see `.gitignore` head comment).

Both locations stay in lockstep manually for now. To deploy after merge:

```bash
# From repo root:
cp docs/xano-schemas/2026-05-15/table/*.xs xano-workspace/table/
cp docs/xano-schemas/2026-05-15/api/financial/*.xs xano-workspace/api/financial/   # after Phase 2 lands
xano push                                                                          # applies to live Xano
```

Then apply seed data once:

```bash
# Apply seed.sql from the Xano dashboard SQL Console
# (Database tab → SQL → paste contents of seed.sql → Run)
```

### Files (Phase 1 — tables)

| File | Purpose |
|---|---|
| `table/warranty_vendor_accounts.xs` | NEW. One row per warranty account that pays us. |
| `table/warranty_payment_batches.xs` | NEW. One row per EFT remittance. Idempotent by gmail_message_id. |
| `table/warranty_payment_lines.xs` | NEW. Per-claim breakdown within a batch. Matched to jobs. |
| `table/tech_payroll_periods.xs` | NEW. Twice-monthly pay-period rollups (3rd / 18th). |
| `table/tech_payroll_lines.xs` | NEW. Per-job tech-commission ledger. |
| `table/technicians.xs` | EXTENDED. Added `commission_rate` column. |
| `table/job_financial.xs` | EXTENDED. 11 new fields for warranty-payment linkage + tax + commission snapshots. |
| `seed.sql` | Seed rows: vendor accounts + tech commission_rate values. |

See `docs/financial-system-design-2026-05-15.md` for the full spec
(tables §6, endpoints §7, business rules §8).
