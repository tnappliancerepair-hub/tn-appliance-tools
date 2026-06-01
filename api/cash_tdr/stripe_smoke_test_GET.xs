//  Stripe smoke test (Phase 1c step 3d.1, 2026-05-06).
//  Verifies Xano can authenticate to Stripe API using STRIPE_SECRET_KEY env var.
//  Hits /v1/balance (read-only, safe) and returns the response so we can verify
//  the auth path works before building the real Checkout Session integration.
// 
//  DELETE after step 3d.1 verification passes.
// 
//  Header construction uses literal-array form per xano_script_parser_gotchas.md
//  (the |push two-arg form silently drops headers; we documented this 2026-05-06).
query stripe_smoke_test verb=GET {
  api_group = "cash_tdr"

  input {
  }

  stack {
    api.request {
      url = "https://api.stripe.com/v1/balance"
      method = "GET"
      headers = ["Authorization: Bearer " ~ $env.STRIPE_SECRET_KEY]
    } as $stripe_resp
  }

  response = {
    http_status: $stripe_resp.response.status
    body       : $stripe_resp.response.result
  }

  guid = "_SWhv6XF3_j-SMDTn6hJaLFTlm8"
}