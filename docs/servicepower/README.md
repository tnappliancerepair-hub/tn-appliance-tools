# ServicePower Integration Guide Library

**Last updated:** 2026-05-07
**Status:** Inventory only — contents not yet read or summarized.

This folder holds the PDF integration guides ServicePower publishes
through their help portal (article: "Servicer API Integrations" by
Marianne Crawford, 2025-04-22). They describe the SOAP/WSDL services
that vendors like TN Appliance can call to read work orders, submit
claims, request authorizations, and (per `warranty-operations-strategy.md`'s
working assumption) update dispatch capacity programmatically.

These docs are the source material for the upcoming Phase 3 (capacity
governor) and Phase 4 (claims/auth automation) builds. See
`docs/warranty-operations-strategy.md` for the architectural context.

## Inventory

| File | Size | Phase target |
|---|---|---|
| `Servicer_Integration_Guide_-_Claims_Retrieval_v1_2.pdf` | 1.3 MB | Phase 4 — financial visibility |
| `Servicer_Integration_Guide_-_Claims_Submission_v1_10.pdf` | 1.4 MB | Phase 4 — automated claim submission |
| `Servicer_Integration_Guide_-_Create_Request_for_Authorization_Web_Service_V2_5.pdf` | 1.3 MB | Phase 4 — field auth requests |
| `Servicer_Integration_Guide_-_Retrieve_Request_for_Authorization_Web_Service_V2_10.pdf` | 1.4 MB | Phase 4 |
| `Servicer_Integration_Guide_-_Dispatch_Web_Service_Interface_v2_8.pdf` | 9.7 MB | **Phase 3 — capacity governor ⭐** |
| `Dispatch_Details_-_Contractor_Portal.pdf` | 25.7 MB | Bonus — contents unknown until inspected |

## Notes

- **All filenames normalized to underscores** for shell-friendliness;
  ServicePower distributes them with spaces. The version suffixes
  (`v1_2`, `v1_10`, `V2_5`, `V2_10`, `v2_8`) match the source filenames'
  numbering, with the dot replaced by underscore.
- The `(1)` suffix on the Dispatch Web Service Interface PDF (a
  download-duplicate artifact) was dropped during normalization; the
  saved file is the v2.8 guide.
- The `Dispatch Details _ Contractor Portal.pdf` is a separate larger
  document (25.7 MB) that wasn't on the original "5 integration guides"
  inventory. Saved here because it surfaced alongside the others on
  disk; we'll find out what it is once someone reads it.

## Next steps

- Phase 3 build will read the **Dispatch Web Service Interface v2.8**
  PDF in full and produce `docs/capacity-governor-design.md` citing the
  actual SOAP method names, auth model, and time-band rules from that
  document. Until that read happens, no design claims based on these
  PDFs are in the repo.
- Phase 4 builds (Claims, RFA) will follow the same read-then-design
  pattern.

## Related

- `docs/warranty-operations-strategy.md` — operational context, three-layer
  architecture vision, why we want SOAP integration
- `docs/tech-operational-profiles.md` — per-tech preferences that the
  capacity governor will encode
