// DEPRECATED 2026-05-28. HCP is fully separated. This endpoint used to
// answer "are we ready to flip the switch?" — irrelevant now. Returns a
// fixed deprecated payload. No DB reads, no logic, no env checks.
// Kept (not deleted) so callers that haven't been swept get a clear
// gone-signal instead of a 404 mystery.
query get_hcp_cutover_readiness verb=GET {
  api_group = "intake"

  input {
  }

  stack {
  }

  response = {
    status         : "deprecated"
    reason         : "HCP fully separated 2026-05-28 — readiness check no longer meaningful"
    deprecated_on  : "2026-05-28"
    successor      : null
  }

  guid = "get-hcp-cutover-readiness-deprecated"
}
