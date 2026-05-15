// Build the per-period payroll report. Used by:
//   - The financial dashboard "Current payroll period" section
//   - The approve_payroll_POST endpoint for the pre-approval preview
//
// Disputed lines are EXCLUDED from commission totals (per business
// rule §8.1 in docs/financial-system-design-2026-05-15.md).
//
// Input can be either an explicit (period_start, period_end) tuple
// or a single pay_date that we resolve to the conventional period
// (1st-15th → pay_date=18th; 16th-end-of-month → pay_date=3rd of
// the following month).
//
// See docs/financial-system-design-2026-05-15.md §7.5
query get_payroll_report verb=GET {
  api_group = "financial"

  input {
    timestamp? period_start?
    timestamp? period_end?
    timestamp? pay_date?
  }

  stack {
    // Derive period bounds from pay_date if explicit bounds not given.
    var $start { value = $input.period_start }
    var $end   { value = $input.period_end }

    conditional {
      if (($start == null || $end == null) && $input.pay_date != null) {
        // Pay date 3rd → period 16-end of prior month; pay date 18th →
        // period 1-15 of current month. Simplified — caller can override.
        var $pd_day { value = ($input.pay_date|format_date:"d")|number }

        conditional {
          if ($pd_day <= 5) {
            // Period is 16 → end of previous month
            var $start { value = (($input.pay_date|subtract_days:30)|format_date:"Y-m-16")|to_timestamp }
            var $end   { value = (($input.pay_date|subtract_days:18)|format_date:"Y-m-t 23:59:59")|to_timestamp }
          } else {
            // Period is 1 → 15 of current month
            var $start { value = ($input.pay_date|format_date:"Y-m-01")|to_timestamp }
            var $end   { value = ($input.pay_date|format_date:"Y-m-15 23:59:59")|to_timestamp }
          }
        }
      }
    }

    // Locate or create the period row.
    db.query tech_payroll_periods {
      where  = "period_start = ? AND period_end = ?"
      params = [$start, $end]
      limit  = 1
    } as $period_rows

    var $period { value = ($period_rows|first ?? null) }

    conditional {
      if ($period == null) {
        db.add tech_payroll_periods {
          fields = {
            period_start: $start
            period_end  : $end
            pay_date    : ($input.pay_date ?? $end)
            status      : "pending"
          }
        } as $period
      }
    }

    // Pull all warranty_payment_lines that fall in this period AND are
    // matched (or accept_partial-resolved). Disputed-and-unresolved
    // lines are excluded from commission totals.
    db.query warranty_payment_lines {
      where  = "created_at >= ? AND created_at <= ? AND (match_status = 'matched' OR resolution_status = 'accept_partial')"
      params = [$start, $end]
    } as $period_lines

    // Group by tech_id and compute summaries.
    var $by_tech { value = {} }
    var $tot_labor      { value = 0 }
    var $tot_parts      { value = 0 }
    var $tot_commission { value = 0 }
    var $tot_tax        { value = 0 }

    foreach ($period_lines) {
      each as $line {
        conditional {
          if ($line.tech_id != null) {
            var $tot_labor      { value = ($tot_labor + ($line.labor_amount ?? 0)) }
            var $tot_parts      { value = ($tot_parts + ($line.parts_amount ?? 0)) }
            var $tot_commission { value = ($tot_commission + ($line.commission_amount ?? 0)) }
            var $tot_tax        { value = ($tot_tax + ($line.tax_amount ?? 0)) }
          }
        }
      }
    }

    // Get all techs with rates for grouping output.
    db.query technicians {
      where  = "active = ?"
      params = [true]
    } as $techs

    var $tech_groups { value = [] }

    foreach ($techs) {
      each as $tech {
        var $tech_lines { value = [] }
        var $tech_labor      { value = 0 }
        var $tech_commission { value = 0 }
        var $tech_parts      { value = 0 }
        var $tech_tax        { value = 0 }

        foreach ($period_lines) {
          each as $line {
            conditional {
              if ($line.tech_id == $tech.id) {
                var $tech_lines      { value = ($tech_lines|push:$line) }
                var $tech_labor      { value = ($tech_labor + ($line.labor_amount ?? 0)) }
                var $tech_commission { value = ($tech_commission + ($line.commission_amount ?? 0)) }
                var $tech_parts      { value = ($tech_parts + ($line.parts_amount ?? 0)) }
                var $tech_tax        { value = ($tech_tax + ($line.tax_amount ?? 0)) }
              }
            }
          }
        }

        var $tech_groups {
          value = ($tech_groups|push:{
            tech_id        : $tech.id
            name           : ($tech.first_name ~ " " ~ ($tech.last_name ?? ""))
            commission_rate: ($tech.commission_rate ?? 0)
            lines          : $tech_lines
            totals         : {
              lines_count     : ($tech_lines|length)
              labor_paid      : $tech_labor
              commission_owed : $tech_commission
              parts_paid      : $tech_parts
              tax_collected   : $tech_tax
            }
          })
        }
      }
    }

    // Count disputed-unresolved separately so the dashboard can show
    // the "$X locked out until disputes resolve" indicator.
    db.query warranty_payment_lines {
      where  = "created_at >= ? AND created_at <= ? AND match_status = 'disputed' AND (resolution_status IS NULL OR resolution_status = 'unresolved')"
      params = [$start, $end]
    } as $disputed_lines

    var $disputed_count  { value = ($disputed_lines|length) }
    var $disputed_amount { value = 0 }
    foreach ($disputed_lines) {
      each as $d {
        var $disputed_amount { value = ($disputed_amount + ($d.dispute_amount ?? 0)) }
      }
    }

    return {
      value = {
        period : {
          id          : $period.id
          period_start: $start
          period_end  : $end
          pay_date    : ($input.pay_date ?? $period.pay_date)
          status      : $period.status
        }
        techs : $tech_groups
        period_totals : {
          total_labor              : $tot_labor
          total_parts              : $tot_parts
          total_commission_owed    : $tot_commission
          total_tax_liability      : $tot_tax
          disputed_jobs_count      : $disputed_count
          disputed_amount_excluded : $disputed_amount
        }
      }
    }
  }
}
