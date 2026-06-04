// The killer endpoint — Brooke calls this mid-job. Given a model
// number + component name (e.g. "water pump"), returns the OEM part
// number from the parts_catalog. If not yet cached, falls through to
// an on-demand enumeration path (Phase 2). For now: cache lookup only.
query source_part_for_model verb=POST {
  api_group = "intake"

  input {
    text model_number
    text component
    text? brand?
    text? appliance_category?
  }

  stack {
    var $model_clean { value = ($input.model_number|upper)|trim }
    var $component_clean { value = ($input.component|lower)|trim }
    var $brand_clean { value = (($input.brand ?? "")|lower)|trim }
    var $cat_clean { value = (($input.appliance_category ?? "")|lower)|trim }

    // Exact model match first (highest confidence)
    db.query parts_catalog {
      where = $db.parts_catalog.appliance_model == $model_clean && $db.parts_catalog.component_category == $component_clean
      sort = {parts_catalog.scraped_at_ms: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $exact_rows

    var $exact_match { value = (($exact_rows.items|first) ?? null) }

    // Fallback: brand + appliance + component (looser match)
    db.query parts_catalog {
      where = $db.parts_catalog.appliance_brand == $brand_clean && $db.parts_catalog.appliance_category == $cat_clean && $db.parts_catalog.component_category == $component_clean
      sort = {parts_catalog.scraped_at_ms: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $loose_rows

    var $loose_match { value = (($loose_rows.items|first) ?? null) }

    var $best { value = ($exact_match ?? $loose_match) }
    var $match_type { value = ($exact_match != null) ? "exact" : (($loose_match != null) ? "brand_category" : "none") }
  }

  response = {
    success      : true
    model_number : $model_clean
    component    : $component_clean
    found        : ($best != null)
    match_type   : $match_type
    part         : $best
    other_candidates: ($exact_rows.items ?? [])
  }

  guid = "source-part-for-model-v1"
}
