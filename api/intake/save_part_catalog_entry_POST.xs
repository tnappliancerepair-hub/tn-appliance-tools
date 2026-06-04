// Harvester agent calls this to persist a part it found. Includes
// deduplication: if a row exists for same (model + part_number),
// updates the existing row's scraped_at_ms + confidence.
query save_part_catalog_entry verb=POST {
  api_group = "intake"

  input {
    text part_number
    text? part_description?
    text? component_category?
    text? appliance_brand?
    text? appliance_category?
    text? appliance_model?
    text? model_pattern?
    int? retail_price_cents?
    text? source_site?
    text? source_url?
    text? confidence?
    text? notes?
  }

  stack {
    var $pn_clean { value = $input.part_number|upper|trim }
    var $model_clean { value = (($input.appliance_model ?? "")|upper)|trim }

    db.query parts_catalog {
      where = $db.parts_catalog.part_number == $pn_clean && $db.parts_catalog.appliance_model == $model_clean
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows

    var $existing { value = (($existing_rows.items|first) ?? null) }
    var $row_id { value = ($existing == null) ? 0 : $existing.id }

    conditional {
      if ($existing == null) {
        db.add parts_catalog {
          data = {
            part_number       : $pn_clean
            part_description  : ($input.part_description ?? "")
            component_category: (($input.component_category ?? "")|lower)
            appliance_brand   : (($input.appliance_brand ?? "")|lower)
            appliance_category: (($input.appliance_category ?? "")|lower)
            appliance_model   : $model_clean
            model_pattern     : ($input.model_pattern ?? "")
            retail_price_cents: ($input.retail_price_cents ?? 0)
            source_site       : ($input.source_site ?? "")
            source_url        : ($input.source_url ?? "")
            confidence        : ($input.confidence ?? "low")
            scraped_at_ms     : (now|to_ms)
            notes             : ($input.notes ?? "")
          }
        } as $created
        var.update $row_id { value = $created.id }
      }
    }
    conditional {
      if ($existing != null) {
        db.edit parts_catalog {
          field_name = "id"
          field_value = $existing.id
          data = {
            scraped_at_ms: (now|to_ms)
            confidence   : ($input.confidence ?? $existing.confidence)
            retail_price_cents: ($input.retail_price_cents ?? $existing.retail_price_cents)
          }
        }
      }
    }
  }

  response = {
    success: true
    row_id : $row_id
    deduped: ($existing != null)
  }

  guid = "save-part-catalog-entry-v1"
}
