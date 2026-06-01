# Ant API Specification

The single source of truth for every endpoint the office, tech, and customer
surfaces use. Built on **OpenAPI 3.0**.

## Why this exists

Before this layer, every browser page directly called Xano endpoints by URL
with hardcoded field names. Renaming a Xano field (e.g. `scheduling_status` →
`state`) silently broke every page that referenced the old name.

The spec defines:
- Every endpoint's URL, method, request shape, response shape
- Versioning per endpoint
- A generated JS client that all browser pages use instead of raw fetch

Means:
- Renaming Xano internals doesn't break browser pages — the client handles
  field mapping
- Multi-tenant SaaS works (each tenant can be on a different schema version)
- New developer can read ONE document instead of 80 endpoint files

## Files

- `ant-api.yaml` — the OpenAPI spec (this is the source of truth)
- `client/ant-client.js` — the generated browser client. Include via
  `<script src="/api-spec/client/ant-client.js"></script>` and call
  `window.Ant.api.getOfficeToday()` etc.
- `client/types.d.ts` — TypeScript types for the response shapes (if/when
  any page wants type safety)

## How to add a new endpoint

1. Add it to `ant-api.yaml` under `paths:`
2. Add a corresponding wrapper in `client/ant-client.js`
3. Update browser pages to use the new method

## Versioning

Each endpoint carries an `x-version` field. Major version bumps require
either:
- Maintain the old endpoint at its old URL until all callers migrate
- Add a compatibility shim in `ant-client.js` that translates the response

## Status

This is a foundation sprint. The 10 most-used endpoints are documented
and the office-today.html page is migrated as proof of concept. Remaining
~70 endpoints + migration of other browser pages is incremental work over
the coming days.
