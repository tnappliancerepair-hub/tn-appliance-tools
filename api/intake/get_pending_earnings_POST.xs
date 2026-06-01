// Returns pending-payment earnings for a single tech, enriched with job +
// customer info for display. Called from office-tn.html's Waiting for Payment
// section, one call per tech (Jimmy=2, Lee=4, Teddy=1).
query get_pending_earnings verb=POST {
  api_group = "intake"

  input {
    int tech_id
  }

  stack {
    db.query tech_earnings {
      where = $db.tech_earnings.tech_id == $input.tech_id && $db.tech_earnings.status == "pending_payment"
      sort = {tech_earnings.earned_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $earnings_list
  
    // Enrich each earning with job + customer for display context.
    var $items {
      value = []
    }
  
    foreach ($earnings_list.items) {
      each as $e {
        var $j {
          value = null
        }
      
        conditional {
          if ($e.job_id != null && $e.job_id > 0) {
            db.get jobs {
              field_name = "id"
              field_value = $e.job_id
            } as $j
          }
        }
      
        var $cust {
          value = null
        }
      
        conditional {
          if ($j != null && $j.customer_id != null && $j.customer_id > 0) {
            db.get customer {
              field_name = "id"
              field_value = $j.customer_id
            } as $cust
          }
        }
      
        var $cust_name {
          value = ((($cust.first_name ?? "") ~ " " ~ ($cust.last_name ?? ""))|trim)
        }
      
        array.push $items {
          value = {
            earning : {
              id                : $e.id
              commission_rate   : $e.commission_rate
              commission_earned : $e.commission_earned
              status            : $e.status
              earned_at         : $e.earned_at
            }
            job     : {
              id             : ($j.id ?? null)
              brand          : ($j.brand ?? null)
              appliance_type : ($j.appliance_type ?? null)
            }
            customer: {
              name : $cust_name
              city : ($cust.city ?? null)
            }
          }
        }
      }
    }
  }

  response = {success: true, items: $items}
  guid = "vfbBFZqvZc7K8r2d5kxQ1rEydaw"
}