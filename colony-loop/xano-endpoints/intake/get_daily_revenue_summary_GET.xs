// Aggregates today's completed jobs for the daily revenue summary SMS.
// Returns count + per-tech breakdown + warranty vs self-pay split. Pricing
// dollars aren't computed here (jobs.total_owed varies in coverage) — the
// agent surfaces volume; Alyse / Stripe reconciliation owns the dollars.
query get_daily_revenue_summary verb=GET {
  api_group = "intake"

  input {
    int since_ts_ms
  }

  stack {
    db.query jobs {
      where = $db.jobs.job_completed_at >= $input.since_ts_ms
      sort = {jobs.job_completed_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $rows

    var $count {
      value = 0
    }

    var $warranty_count {
      value = 0
    }

    var $self_pay_count {
      value = 0
    }

    var $by_tech_arr {
      value = []
    }

    var $brief {
      value = []
    }

    foreach ($rows.items) {
      each as $j {
        var.update $count {
          value = $count + 1
        }
        conditional {
          if (($j.customer_type ?? "") == "warranty") {
            var.update $warranty_count {
              value = $warranty_count + 1
            }
          }
          else {
            var.update $self_pay_count {
              value = $self_pay_count + 1
            }
          }
        }
        var $entry {
          value = {
            tech_id           : ($j.technician_id ?? 0)
            id                : $j.id
            customer_type     : ($j.customer_type ?? "")
            appliance_type    : ($j.appliance_type ?? "")
            job_completed_at  : ($j.job_completed_at ?? 0)
            completion_type   : ($j.completion_type ?? "")
          }
        }
        var.update $brief {
          value = $brief|push:$entry
        }
      }
    }
  }

  response = {
    since_ts_ms     : $input.since_ts_ms
    total_completed : $count
    warranty_count  : $warranty_count
    self_pay_count  : $self_pay_count
    jobs            : $brief
  }

  guid = "get-daily-revenue-summary-v1"
}
