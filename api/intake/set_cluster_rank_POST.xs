//  Set (create or update) a tech's rank + active flag for a cluster. This is
//  the re-rank path the office uses from cluster-ranks.html so the smart-
//  routing suggestion (rank-1 active non-owner) points at the right tech.
//  add_tech_to_cluster only inserts; this also UPDATES an existing row.
//
//  XS rules: no em-dashes, no try/catch, data = { } for db.edit/db.add,
//  ?? + |trim only in value = (...), (($rows.items|first) ?? null).
query set_cluster_rank verb=POST {
  api_group = "intake"

  input {
    text cluster
    int technician_id
    int rank
    bool? active?
  }

  stack {
    var $cl {
      value = (($input.cluster ?? "")|trim)
    }

    precondition ($cl != "" && $input.technician_id > 0 && $input.rank > 0) {
      error_type = "inputerror"
      error = "cluster, technician_id, rank required"
    }

    var $is_active {
      value = ($input.active ?? true)
    }

    db.query cluster_assignment {
      where = $db.cluster_assignment.cluster == $cl && $db.cluster_assignment.technician_id == $input.technician_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows

    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }

    var $mode {
      value = "created"
    }

    conditional {
      if ($existing != null) {
        db.edit cluster_assignment {
          field_name = "id"
          field_value = $existing.id
          data = {
            rank   : $input.rank
            active : $is_active
          }
        }

        var.update $mode {
          value = "updated"
        }
      }

      else {
        db.add cluster_assignment {
          data = {
            cluster       : $cl
            technician_id : $input.technician_id
            rank          : $input.rank
            active        : $is_active
            notes         : "set via cluster-ranks"
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "cluster_rank_set"
        metadata : {
          cluster       : $cl
          technician_id : $input.technician_id
          rank          : $input.rank
          active        : $is_active
          mode          : $mode
        }
      }
    } as $log
  }

  response = {
    success       : true
    cluster       : $cl
    technician_id : $input.technician_id
    rank          : $input.rank
    active        : $is_active
    mode          : $mode
  }

  guid = "set-cluster-rank-v1"
}
