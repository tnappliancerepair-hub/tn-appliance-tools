//  One-shot cleanup for customers where first_name == last_name (data import
//  corruption from HCP, typically couple-named customers like "Cory & Gina
//  Welch" landing as first="Cory" last="Cory" after a bad import parse).
// 
//  Strategy: find affected rows, leave them with the SAME first_name (so
//  search continues to find them by name), but blank the last_name AND
//  set a flag in notes for future re-merge if HCP webhook ever returns a
//  clean version.
// 
//  dry_run defaults to true — operator must explicitly confirm to write.
query cleanup_duplicate_name_customers verb=POST {
  api_group = "intake"

  input {
    bool? dry_run?
  }

  stack {
    var $dryrun {
      value = (($input.dry_run ?? true) != false)
    }
  
    db.query customer {
      sort = {customer.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 5000}}
    } as $all
  
    var $hits {
      value = []
    }
  
    var $fixed_count {
      value = 0
    }
  
    foreach ($all.items) {
      each as $c {
        var $f {
          value = (($c.first_name ?? "")|trim)
        }
      
        var $l {
          value = (($c.last_name ?? "")|trim)
        }
      
        conditional {
          if ($f != "" && $f == $l) {
            // Build the hit record for the response
            var $hit {
              value = {
                id        : $c.id
                first_name: $f
                last_name : $l
                phone     : ($c.phone ?? "")
                city      : ($c.city ?? "")
              }
            }
          
            var.update $hits {
              value = $hits|push:$hit
            }
          
            conditional {
              if (!$dryrun) {
                db.edit customer {
                  field_name = "id"
                  field_value = $c.id
                  data = {last_name: ""}
                } as $upd
              
                // audit trail via event_log (customer table has no notes column)
                db.add event_log {
                  data = {
                    action  : "customer_dup_name_cleanup"
                    metadata: {
                    customer_id   : $c.id
                    original_first: $f
                    original_last : $l
                    cleanup_action: "blanked_last_name"
                  }
                  }
                } as $audit
              
                var.update $fixed_count {
                  value = $fixed_count + 1
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success                : true
    dry_run                : $dryrun
    total_customers_scanned: $all.items|count
    duplicate_name_count   : $hits|count
    rows_modified          : $fixed_count
    samples                : $hits|slice:0:20
    note                   : $dryrun ? "DRY RUN — no writes. Re-call with dry_run:false to commit." : "WRITES COMMITTED."
  }

  guid = "cleanup-duplicate-name-customers-v1"
}