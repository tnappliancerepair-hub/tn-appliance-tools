// Returns accounts receivable aging buckets per customer. Self-pay
// completed jobs with payment_collected=false, grouped by age buckets:
// 0-30d, 31-60d, 61-90d, 90+d.
query get_ar_aging_by_customer verb=GET {
  api_group = "intake"

  input {}

  stack {
    var $now_ms {
      value = now|to_ms
    }

    var $day_ms {
      value = 24 * 60 * 60 * 1000
    }

    db.query jobs {
      where  = $db.jobs.scheduling_status == "completed" && $db.jobs.customer_type == "self_pay" && $db.jobs.payment_collected == false && $db.jobs.job_completed_at != null
      sort   = {jobs.job_completed_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $job_rows

    var $by_customer {
      value = {}
    }

    foreach ($job_rows.items) {
      each as $j {
        var $cid_val {
          value = ($j.customer_id ?? 0)
        }

        conditional {
          if ($cid_val > 0) {
            var $key {
              value = $cid_val|to_text
            }

            var $age_days {
              value = (($now_ms - ($j.job_completed_at|to_ms)) / $day_ms)|round:0
            }

            var $bucket {
              value = ($age_days <= 30 ? "0-30" : ($age_days <= 60 ? "31-60" : ($age_days <= 90 ? "61-90" : "90+")))
            }

            var $existing {
              value = (($by_customer|get:$key) ?? null)
            }

            conditional {
              if ($existing == null) {
                db.get customer {
                  field_name  = "id"
                  field_value = $cid_val
                } as $cust

                var $new_entry {
                  value = {
                    customer_id  : $cid_val
                    name         : (($cust.first_name ?? "") ~ " " ~ ($cust.last_name ?? ""))|trim
                    phone        : ($cust.phone ?? "")
                    open_jobs    : 1
                    oldest_days  : $age_days
                    bucket       : $bucket
                  }
                }

                var.update $by_customer {
                  value = $by_customer|set:$key:$new_entry
                }
              }

              else {
                var $new_bucket {
                  value = ($age_days > $existing.oldest_days ? $bucket : $existing.bucket)
                }

                var $new_oldest {
                  value = ($age_days > $existing.oldest_days ? $age_days : $existing.oldest_days)
                }

                var $updated {
                  value = $existing|set:"open_jobs":($existing.open_jobs + 1)|set:"oldest_days":$new_oldest|set:"bucket":$new_bucket
                }

                var.update $by_customer {
                  value = $by_customer|set:$key:$updated
                }
              }
            }
          }
        }
      }
    }

    var $keys {
      value = $by_customer|keys
    }

    var $list {
      value = []
    }

    foreach ($keys) {
      each as $k {
        var.update $list {
          value = $list|push:($by_customer|get:$k)
        }
      }
    }
  }

  response = {
    success      : true
    customer_count: ($list|count)
    customers    : $list
  }

  guid = "get-ar-aging-by-customer-v1"
}
