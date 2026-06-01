// Daily 6am CT cron. Calls error_hunter endpoint which scans last 24hrs of event_log for failure patterns (fail/error/not_found/unhandled) and asks Claude for fix proposals. Proposals land in agent_proposals (source_builder=error_hunter) for human review.
task error_hunter {
  stack {
  }

  schedule = []
  guid = "db86zQpflcLY1X6qF8NFYDRDV6I"
}