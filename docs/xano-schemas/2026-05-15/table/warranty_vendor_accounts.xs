// Catalogue of every warranty/insurance account that pays us. One row
// per (company, vendor_number) pair. The remittance parsers read the
// vendor number from each incoming email header and FK back to this
// table — that's how we know which state, which tax rule, and which
// commission set applies to a payment line.
//
// New rows can be auto-created by the parsers when an unknown vendor
// number appears. Auto-created rows ship with active=false so the
// owner must review and activate from the financial dashboard before
// commissions calculate on those payments. See
// docs/financial-system-design-2026-05-15.md §5 for seed list and §6.1
// for full schema notes.
//
// Created 2026-05-15 as part of the financial system build.
table warranty_vendor_accounts {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }

    // 'ahs' | 'squaretrade_servicepower' | 'nsa' | '210'. Free text but
    // parsers only emit these four values; new companies require a new
    // intake endpoint anyway, so enum-via-convention is safer than
    // schema-enforced enum (no migration when we add the 5th company).
    text company? filters=trim

    // The vendor identifier from the remittance header. AHS uses
    // dash-prefixed numerics (e.g. "1-822418"). SquareTrade uses
    // TNA##### codes. 210 uses a check series. NSA — TBD.
    text vendor_number? filters=trim

    // 'TN' | 'LA' | '' (unknown — auto-created rows default to empty
    // until owner reviews). Drives the tax-on-parts rule downstream.
    text state? filters=trim

    // Free-text description so the dashboard "outstanding by company"
    // groupings can show useful labels like "New Orleans metro" or
    // "Davidson County" instead of just vendor numbers.
    text area_description? filters=trim

    // When false, payment lines tagged to this vendor account get
    // match_status='unmatched' regardless of claim match, and
    // commissions stay at $0. Used as the "needs owner review" gate
    // for auto-created rows. Toggled true from the dashboard.
    bool active?=true

    // Set true when we've inserted a placeholder row for a vendor we
    // know exists (e.g. AHS third LA account) but don't yet have the
    // exact vendor_number to populate. Parser will not match payments
    // to this row until vendor_number is filled in and pending=false.
    bool vendor_number_pending?=false

    // Free-text notes for the owner — when this account was opened,
    // who's the contact, special handling rules, etc.
    text notes?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "company"}, {name: "vendor_number"}], unique: true}
    {type: "btree", field: [{name: "active"}]}
  ]
}
