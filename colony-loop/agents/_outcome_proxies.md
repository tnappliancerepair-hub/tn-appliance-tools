# Outcome linker proxy agents

The outcome linker is invoked from three existing signal consumers — NOT
as standalone dispatch handlers. Adding proxy agents would cause double
dispatch with job_completed.js / customer_feedback_received.js / etc.

Instead, the existing agents call `linkOutcomesForJob` from
`claude_outcome_linker.js` directly after their own work completes.

Wired sites:
- `job_completed.js` — calls with outcome_type='job_completed', entity_key='job_id'
- `customer_feedback_received.js` — calls with outcome_type='customer_rating', entity_key='customer_id'
- `warranty_claim_action.js` — calls with outcome_type='warranty_clear', entity_key='job_id' (only when action='clear')

The standalone `claude_outcome_linker.js` `run()` export still works for
direct injection (testing / manual fan-out) via signal_type=CLAUDE_OUTCOME_LINK.
