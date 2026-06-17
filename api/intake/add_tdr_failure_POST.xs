// add_tdr_failure - append an additional failed-part row to an EXISTING tdr so a
// single TDR can carry multiple parts (e.g. water filter + air filter), each with
// its own OEM + Amazon option + cost. qc_diagnosis_view already renders every
// tdr_failure row for a TDR as its own section, so this is all the create side
// needs for multi-part TDRs. create_tdr makes the TDR + the first failure; the
// Teddy Tool calls this for each extra part.
//
//   POST { tdr_id, failure_description, oem_part_number?, amazon_part_number?,
//          oem_part_our_cost_cents?, amazon_part_our_cost_cents?,
//          labor_customer_cost_cents? }
//   -> { success, failure_id, tdr_id }
query add_tdr_failure verb=POST {
  api_group = "intake"

  input {
    int tdr_id
    text failure_description filters=trim
    text oem_part_number? filters=trim
    text amazon_part_number? filters=trim
    int oem_part_our_cost_cents?
    int amazon_part_our_cost_cents?
    int labor_customer_cost_cents?
  }

  stack {
    var $desc {
      value = (($input.failure_description ?? "")|trim)
    }

    precondition ($input.tdr_id > 0 && $desc != "") {
      error_type = "inputerror"
      error = "tdr_id and failure_description are required"
    }

    db.add tdr_failure {
      data = {
        tdr_id                        : $input.tdr_id
        failure_description           : $desc
        tenant_reported               : false
        recommended_oem_part_number   : ($input.oem_part_number ?? null)
        oem_part_our_cost_cents       : ($input.oem_part_our_cost_cents ?? 0)
        recommended_amazon_part_number: ($input.amazon_part_number ?? null)
        amazon_part_our_cost_cents    : ($input.amazon_part_our_cost_cents ?? 0)
        labor_customer_cost_cents     : ($input.labor_customer_cost_cents ?? 0)
        selected_option               : "pending"
      }
    } as $new_failure

    return {
      value = {success: true, failure_id: $new_failure.id, tdr_id: $input.tdr_id}
    }
  }
}
