// Single round-trip context for the customer_intake_bundle_ready agent.
// Returns job + customer + assigned tech (if any) + cluster_techs (all
// active techs in the service zone's cluster) + attachment count. The
// agent uses cluster_techs to decide if there's exactly one tech for
// this zip — in which case the SMS fires to that tech immediately,
// even before formal assignment.
query get_customer_intake_bundle_context verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $customer_id { value = ($job.customer_id ?? 0) }
    var $customer    { value = null }
    conditional {
      if ($customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $customer_id
        } as $cust_row
        var.update $customer { value = $cust_row }
      }
    }

    var $tech_id        { value = ($job.technician_id ?? 0) }
    var $assigned_tech  { value = null }
    conditional {
      if ($tech_id > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $tech_id
        } as $tech_row
        var.update $assigned_tech { value = $tech_row }
      }
    }

    // Zone + cluster + cluster techs
    var $zip { value = (($job.service_zip ?? "")|trim) }
    var $zone { value = null }
    conditional {
      if ($zip != "") {
        db.query service_zone {
          where = $db.service_zone.zip_code == $zip
          return = {type: "single"}
        } as $zone_row
        var.update $zone { value = $zone_row }
      }
    }

    var $cluster_id { value = (($zone.cluster_id ?? "")|trim) }
    var $cluster_techs { value = [] }

    conditional {
      if ($cluster_id != "") {
        db.query technicians {
          where = $db.technicians.active == true
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $all_techs

        foreach ($all_techs.items) {
          each as $t {
            var $t_cluster { value = (($t.cluster_id ?? "")|trim) }
            conditional {
              if ($t_cluster == $cluster_id) {
                var.update $cluster_techs {
                  value = $cluster_techs|push:{
                    id        : $t.id
                    first_name: ($t.first_name ?? "")
                    last_name : ($t.last_name ?? "")
                    phone     : ($t.phone ?? "")
                  }
                }
              }
            }
          }
        }
      }
    }

    // Attachment count + small preview list (latest 5)
    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id && $db.job_attachments.upload_complete_at != null
      sort = {job_attachments.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $atts

    var $attachment_count { value = ($atts.items|count) }
  }

  response = {
    job              : $job
    customer         : $customer
    assigned_tech    : $assigned_tech
    cluster_id       : $cluster_id
    cluster_techs    : $cluster_techs
    cluster_tech_count: ($cluster_techs|count)
    attachment_count : $attachment_count
    attachments      : $atts.items
  }

  guid = "get-customer-intake-bundle-context-v1"
}
