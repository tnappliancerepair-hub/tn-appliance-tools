table technicians {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    text first_name? filters=trim
    text last_name? filters=trim
    text phone? filters=trim
    text email? filters=trim
    bool active?=true
    text hcp_id? filters=trim
    text pin? filters=trim

    // Time of day when Ant Tech Scheduler sends this tech's daily summary. HH:MM format (24-hour).
    text daily_summary_time? filters=trim

    // Tech's preferred shift start time. HH:MM format. Overrides bootstrapped 8am if set.
    text preferred_hours_start? filters=trim

    // Tech's preferred shift end time. HH:MM format. Overrides bootstrapped 4pm if set.
    text preferred_hours_end? filters=trim

    // Opt-in personal context the tech shared during onboarding (family, life events, etc.). Free-text.
    text personal_context?

    // When the tech completed Ant Tech Scheduler onboarding. Null = not yet onboarded.
    timestamp onboarding_completed_at?

    // Pending pattern offer surfaced by the nightly ledger task. Set when 3+
    // declines in the last 14 days share a dimension (city/day_of_week/time_window)
    // and the tech doesn't already have a matching preference. Daily-mode CONTEXT
    // block reads this field; Ant brings it up casually. Cleared when an
    // __ADD_PREFERENCE__ with source=pattern_detected fires.
    // Shape: {dimension, value, match_count, detected_at}.
    json? pending_pattern_offer?

    // Integer-percent labor commission rate. 45 = 45% of labor_paid goes
    // to this tech on every job they complete. Owner (Teddy, id=1) sits
    // at 0. Seed values per docs/financial-system-design-2026-05-15.md §3:
    //   id=1 Teddy  → 0     (owner, no commission)
    //   id=2 Jimmy  → 45
    //   id=3 Andre  → 40
    //   id=4 Lee    → 50
    //   id=5 Billy  → 40
    //   id=6 John   → 40
    // Stored as a decimal so future fractional rates work without migration.
    decimal? commission_rate?=0
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "3DPVenNvngHiVbrWUAJz8xmYc7s"
}