// Returns whether a zip code is covered by our service area. Used by:
//   - Web chat intake to fail-fast on out-of-area
//   - Customer-facing pages for "do you cover my area?" lookups
//   - Marketing / SEO templates to surface coverage
query check_service_zone verb=GET {
  api_group = "intake"

  input {
    text zip_code
  }

  stack {
    var $zip {
      value = ($input.zip_code ?? "")|trim
    }
  
    precondition ($zip != "") {
      error_type = "inputerror"
      error = "zip_code is required"
    }
  
    // First 5 chars only (US-style)
    var $zip5 {
      value = ($zip|strlen) > 5 ? ($zip|substr:0:5) : $zip
    }
  
    db.query service_zone {
      where = $db.service_zone.zip_code == $zip5
      sort = {service_zone.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $zone_rows
  
    var $zone {
      value = (($zone_rows.items|first) ?? null)
    }
  
    var $covered {
      value = ($zone != null)
    }
  
    var $accepting {
      value = ($zone != null ? ($zone.accept_new_jobs ?? false) : false)
    }

    // Smart-routing suggestion: the rank-1 ACTIVE NON-OWNER tech who covers
    // this cluster. The owner (tech 1) is last resort only -- per Teddy he
    // should never be the primary pick, only suggested when nobody else can
    // help. So we walk ranks, take the first active non-owner; if NONE exists
    // we fall back to the owner (so a cluster only Teddy covers still resolves
    // to him). The office confirms with a tap.
    var $cluster_name {
      value = ($zone != null ? ($zone.cluster ?? "") : "")
    }

    db.query cluster_assignment {
      where = $db.cluster_assignment.cluster == $cluster_name && $db.cluster_assignment.active == true
      sort = {cluster_assignment.rank: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $assign_rows

    var $suggested_tid {
      value = 0
    }

    var $sug_name {
      value = ""
    }

    // Owner fallback captured separately so he only wins if no one else does.
    var $owner_fallback_tid {
      value = 0
    }

    var $owner_fallback_name {
      value = ""
    }

    foreach ($assign_rows.items) {
      each as $assign {
        conditional {
          if ($suggested_tid == 0) {
            var $cand_tid {
              value = ($assign.technician_id ?? 0)
            }

            conditional {
              if ($cand_tid > 0) {
                db.get technicians {
                  field_name = "id"
                  field_value = $cand_tid
                } as $cand_tech

                conditional {
                  if ($cand_tech != null && ($cand_tech.active ?? false) == true) {
                    conditional {
                      if ($cand_tid == 1) {
                        // Owner: remember as last resort, do not pick yet.
                        conditional {
                          if ($owner_fallback_tid == 0) {
                            var.update $owner_fallback_tid {
                              value = $cand_tid
                            }

                            var.update $owner_fallback_name {
                              value = (($cand_tech.first_name ?? "")|trim)
                            }
                          }
                        }
                      }

                      else {
                        var.update $suggested_tid {
                          value = $cand_tid
                        }

                        var.update $sug_name {
                          value = (($cand_tech.first_name ?? "")|trim)
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // No non-owner covers this cluster -> owner is the only one who can help.
    conditional {
      if ($suggested_tid == 0 && $owner_fallback_tid > 0) {
        var.update $suggested_tid {
          value = $owner_fallback_tid
        }

        var.update $sug_name {
          value = $owner_fallback_name
        }
      }
    }
  }

  response = {
    success           : true
    zip_code          : $zip5
    covered           : $covered
    accepting_new_jobs: $accepting
    market            : ($zone.market ?? "")
    zone              : ($zone.zone ?? "")
    cluster           : ($zone.cluster ?? "")
    state             : ($zone.state ?? "")
    notes             : ($zone.notes ?? "")
    suggested_technician_id : $suggested_tid
    suggested_tech_name     : $sug_name
  }

  guid = "check-service-zone-v1"
}