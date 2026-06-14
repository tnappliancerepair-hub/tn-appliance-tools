//  Lists every cluster_assignment row, joined with the tech's name + active
//  flag, sorted by cluster then rank. Powers cluster-ranks.html so the office
//  can SEE who Ant suggests per area (and re-rank). Read-only.
//
//  XS rules: no em-dashes, no try/catch, ?? + |trim only in value = (...),
//  (($rows.items|first) ?? null), |count not |length.
query list_cluster_assignments verb=GET {
  api_group = "intake"

  input {
  }

  stack {
    db.query cluster_assignment {
      sort = {cluster_assignment.cluster: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $rows

    var $out {
      value = []
    }

    foreach ($rows.items) {
      each as $row {
        var $tid {
          value = ($row.technician_id ?? 0)
        }

        var $tname {
          value = ""
        }

        var $tactive {
          value = false
        }

        conditional {
          if ($tid > 0) {
            db.get technicians {
              field_name = "id"
              field_value = $tid
            } as $t

            conditional {
              if ($t != null) {
                var.update $tname {
                  value = ((($t.first_name ?? "")|trim) ~ " " ~ (($t.last_name ?? "")|trim))|trim
                }

                var.update $tactive {
                  value = (($t.active ?? false) == true)
                }
              }
            }
          }
        }

        var $item {
          value = {
            id            : $row.id
            cluster       : (($row.cluster ?? "")|trim)
            technician_id : $tid
            tech_name     : $tname
            tech_active   : $tactive
            rank          : ($row.rank ?? 0)
            active        : (($row.active ?? false) == true)
            is_owner      : ($tid == 1)
            notes         : (($row.notes ?? "")|trim)
          }
        }

        var.update $out {
          value = $out|push:$item
        }
      }
    }
  }

  response = {
    success     : true
    total       : $out|count
    assignments : $out
  }

  guid = "list-cluster-assignments-v1"
}
