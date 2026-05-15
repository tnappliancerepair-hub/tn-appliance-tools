// Small helper: given a parts cost, return recommended sell prices
// across the three TN Appliance markup tiers. Pure math; no DB read.
//
// Tiers (from the desk in Antioch — set by Teddy, adjustable in the
// $env config later):
//   conservative : cost * 1.6   (60% markup) — high-volume / known commodity parts
//   standard     : cost * 1.85  (85% markup) — most repairs
//   premium      : cost * 2.25  (125% markup) — rare/hard-to-source parts
//
// See docs/financial-system-design-2026-05-15.md §7.10
query parts_markup_calc verb=GET {
  api_group = "financial"

  input {
    decimal cost
    text? preferred_tier?    // 'conservative' | 'standard' | 'premium'
  }

  stack {
    var $cost  { value = ($input.cost ?? 0) }
    var $tier  { value = ($input.preferred_tier ?? "standard") }

    var $conservative { value = ($cost * 1.60) }
    var $standard     { value = ($cost * 1.85) }
    var $premium      { value = ($cost * 2.25) }

    var $recommended {
      value = (
        ($tier == "premium")      ? $premium
        : ($tier == "conservative") ? $conservative
        : $standard
      )
    }

    var $recommended_markup_pct {
      value = (
        ($tier == "premium")      ? 125
        : ($tier == "conservative") ? 60
        : 85
      )
    }

    var $tn_tax_on_recommended { value = ($recommended * 0.0925) }

    return {
      value = {
        cost: $cost
        tiers: {
          conservative: { sell: $conservative, markup_pct: 60,  profit: ($conservative - $cost) }
          standard    : { sell: $standard,     markup_pct: 85,  profit: ($standard     - $cost) }
          premium     : { sell: $premium,      markup_pct: 125, profit: ($premium      - $cost) }
        }
        recommended: {
          tier            : $tier
          sell            : $recommended
          markup_pct      : $recommended_markup_pct
          profit          : ($recommended - $cost)
          tn_tax          : $tn_tax_on_recommended
          total_with_tn_tax: ($recommended + $tn_tax_on_recommended)
        }
      }
    }
  }
}
