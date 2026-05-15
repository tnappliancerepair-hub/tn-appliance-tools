// Aggregated payload for the financial-dashboard.html landing view.
// One round-trip from the dashboard; client renders all sections.
//
// See docs/financial-system-design-2026-05-15.md §7.8
query get_financial_dashboard verb=GET {
  api_group = "financial"

  input {
    timestamp? as_of?
  }

  stack {
    var $as_of { value = ($input.as_of ?? now) }

    // ── Outstanding jobs by company ──────────────────────────────────
    db.query warranty_vendor_accounts {
      where  = "active = ?"
      params = [true]
    } as $vendors

    var $outstanding { value = [] }

    foreach ($vendors) {
      each as $vend {
        db.query jobs {
          where  = "warranty_company = ? AND (id NOT IN (SELECT job_id FROM warranty_payment_lines WHERE job_id IS NOT NULL AND match_status IN ('matched','partial')))"
          params = [$vend.company]
        } as $unpaid_jobs

        conditional {
          if (($unpaid_jobs|length) > 0) {
            var $expected_total { value = 0 }
            var $oldest_age     { value = 0 }

            foreach ($unpaid_jobs) {
              each as $j {
                db.query job_financial {
                  where  = "job_id = ?"
                  params = [$j.id]
                  limit  = 1
                } as $jfs

                var $jf { value = ($jfs|first ?? null) }
                conditional {
                  if ($jf != null) {
                    var $expected_total { value = ($expected_total + (($jf.warranty_payout_expected ?? 0) ?? 0)) }
                  }
                }

                var $age { value = (($as_of - $j.created_at) / 86400)|number }
                conditional {
                  if ($age > $oldest_age) {
                    var $oldest_age { value = $age }
                  }
                }
              }
            }

            var $outstanding {
              value = ($outstanding|push:{
                company         : $vend.company
                vendor_number   : $vend.vendor_number
                state           : $vend.state
                count           : ($unpaid_jobs|length)
                oldest_age_days : $oldest_age
                total_expected  : $expected_total
              })
            }
          }
        }
      }
    }

    // ── Paid this period (last 30 days) ──────────────────────────────
    var $period_start_30 { value = ($as_of|subtract_days:30) }

    db.query warranty_payment_batches {
      where  = "payment_date >= ?"
      params = [$period_start_30]
    } as $recent_batches

    var $paid_by_company { value = {} }

    foreach ($recent_batches) {
      each as $b {
        db.get warranty_vendor_accounts {
          field_name  = "id"
          field_value = $b.vendor_account_id
        } as $vend

        var $company { value = ($vend.company ?? "unknown") }
        var $prev    { value = (($paid_by_company|get:$company) ?? {count: 0, total_paid: 0}) }

        var $paid_by_company {
          value = ($paid_by_company|set:$company:{
            count      : ($prev.count + 1)
            total_paid : ($prev.total_paid + ($b.total_amount ?? 0))
          })
        }
      }
    }

    // ── Commission owed this period ──────────────────────────────────
    // Period derived from as_of: 1-15 of current month, OR 16-end.
    var $day_of_month { value = ($as_of|format_date:"d")|number }

    conditional {
      if ($day_of_month <= 15) {
        var $period_start { value = ($as_of|format_date:"Y-m-01")|to_timestamp }
        var $period_end   { value = ($as_of|format_date:"Y-m-15 23:59:59")|to_timestamp }
      } else {
        var $period_start { value = ($as_of|format_date:"Y-m-16")|to_timestamp }
        var $period_end   { value = ($as_of|format_date:"Y-m-t 23:59:59")|to_timestamp }
      }
    }

    db.query warranty_payment_lines {
      where  = "created_at >= ? AND created_at <= ? AND match_status = 'matched' AND tech_id IS NOT NULL"
      params = [$period_start, $period_end]
    } as $period_lines

    db.query technicians {
      where  = "active = ? AND commission_rate > 0"
      params = [true]
    } as $commish_techs

    var $commission_owed { value = [] }

    foreach ($commish_techs) {
      each as $tech {
        var $tech_total { value = 0 }
        var $tech_count { value = 0 }

        foreach ($period_lines) {
          each as $pl {
            conditional {
              if ($pl.tech_id == $tech.id) {
                var $tech_total { value = ($tech_total + ($pl.commission_amount ?? 0)) }
                var $tech_count { value = ($tech_count + 1) }
              }
            }
          }
        }

        var $commission_owed {
          value = ($commission_owed|push:{
            tech_id     : $tech.id
            name        : ($tech.first_name ~ " " ~ ($tech.last_name ?? ""))
            rate        : ($tech.commission_rate ?? 0)
            lines_count : $tech_count
            total_owed  : $tech_total
          })
        }
      }
    }

    // ── Disputed lines needing resolution ────────────────────────────
    db.query warranty_payment_lines {
      where  = "match_status = 'disputed' AND (resolution_status IS NULL OR resolution_status = 'unresolved')"
      sort   = [{field: "created_at", order: "desc"}]
      limit  = 50
    } as $disputed_lines

    var $disputed_out { value = [] }
    foreach ($disputed_lines) {
      each as $d {
        var $age { value = (($as_of - $d.created_at) / 86400)|number }
        var $disputed_out {
          value = ($disputed_out|push:{
            line_id        : $d.id
            claim_number   : ($d.claim_number ?? $d.dispatch_id)
            customer_name  : ($d.customer_name ?? "")
            gross_amount   : ($d.gross_amount ?? 0)
            net_amount     : ($d.net_amount ?? 0)
            dispute_amount : ($d.dispute_amount ?? 0)
            age_days       : $age
          })
        }
      }
    }

    // ── Tax liability (this period + YTD) ────────────────────────────
    var $period_tax { value = 0 }
    foreach ($period_lines) {
      each as $pl {
        var $period_tax { value = ($period_tax + ($pl.tax_amount ?? 0)) }
      }
    }

    var $ytd_start { value = ($as_of|format_date:"Y-01-01")|to_timestamp }

    db.query warranty_payment_lines {
      where  = "created_at >= ?"
      params = [$ytd_start]
    } as $ytd_lines

    var $ytd_tax { value = 0 }
    foreach ($ytd_lines) {
      each as $pl {
        var $ytd_tax { value = ($ytd_tax + ($pl.tax_amount ?? 0)) }
      }
    }

    // ── P&L (this month + YTD) ───────────────────────────────────────
    var $month_start { value = ($as_of|format_date:"Y-m-01")|to_timestamp }

    db.query warranty_payment_lines {
      where  = "created_at >= ?"
      params = [$month_start]
    } as $month_lines

    var $month_revenue    { value = 0 }
    var $month_parts      { value = 0 }
    var $month_labor_paid { value = 0 }
    var $month_commission { value = 0 }

    foreach ($month_lines) {
      each as $pl {
        var $month_revenue    { value = ($month_revenue    + ($pl.net_amount ?? 0)) }
        var $month_parts      { value = ($month_parts      + ($pl.parts_amount ?? 0)) }
        var $month_labor_paid { value = ($month_labor_paid + ($pl.labor_amount ?? 0)) }
        var $month_commission { value = ($month_commission + ($pl.commission_amount ?? 0)) }
      }
    }

    var $month_net { value = ($month_revenue - ($month_commission + $month_parts)) }

    var $ytd_revenue    { value = 0 }
    var $ytd_parts      { value = 0 }
    var $ytd_commission { value = 0 }
    foreach ($ytd_lines) {
      each as $pl {
        var $ytd_revenue    { value = ($ytd_revenue    + ($pl.net_amount ?? 0)) }
        var $ytd_parts      { value = ($ytd_parts      + ($pl.parts_amount ?? 0)) }
        var $ytd_commission { value = ($ytd_commission + ($pl.commission_amount ?? 0)) }
      }
    }
    var $ytd_net { value = ($ytd_revenue - ($ytd_commission + $ytd_parts)) }

    // ── Recent batches (last 20 for inbox view) ──────────────────────
    db.query warranty_payment_batches {
      sort  = [{field: "payment_date", order: "desc"}]
      limit = 20
    } as $inbox_batches

    var $inbox_out { value = [] }
    foreach ($inbox_batches) {
      each as $b {
        db.get warranty_vendor_accounts {
          field_name  = "id"
          field_value = $b.vendor_account_id
        } as $vend

        var $inbox_out {
          value = ($inbox_out|push:{
            batch_id        : $b.id
            company         : ($vend.company ?? "")
            payment_date    : $b.payment_date
            total           : ($b.total_amount ?? 0)
            status          : $b.status
            matched_count   : ($b.matched_count ?? 0)
            unmatched_count : ($b.unmatched_count ?? 0)
            disputed_count  : ($b.disputed_count ?? 0)
          })
        }
      }
    }

    return {
      value = {
        as_of           : $as_of
        outstanding     : $outstanding
        paid_this_period: $paid_by_company
        commission_owed_this_period: $commission_owed
        disputed        : $disputed_out
        tax_liability   : {
          this_period: $period_tax
          ytd        : $ytd_tax
        }
        pnl: {
          this_month: {
            revenue          : $month_revenue
            parts_cost_paid  : $month_parts
            labor_paid       : $month_labor_paid
            commission_paid  : $month_commission
            net              : $month_net
          }
          ytd: {
            revenue         : $ytd_revenue
            parts_cost_paid : $ytd_parts
            commission_paid : $ytd_commission
            net             : $ytd_net
          }
        }
        recent_batches: $inbox_out
      }
    }
  }
}
