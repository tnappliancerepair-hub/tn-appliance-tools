// One-shot endpoint to retrieve a Stripe Checkout Session by ID for
// verification purposes (Phase 1c step 3d.5 2026-05-06). Idempotent read-only.
// SAFE TO DELETE after verification.
query _stripe_retrieve_session verb=GET {
  api_group = "cash_tdr"

  input {
    text session_id
  }

  stack {
    api.request {
      url = "https://api.stripe.com/v1/checkout/sessions/" ~ $input.session_id ~ "?expand[]=line_items"
      method = "GET"
      headers = ["Authorization: Bearer " ~ $env.STRIPE_SECRET_KEY]
    } as $resp
  }

  response = {
    http_status: $resp.response.status
    body       : $resp.response.result
  }

  guid = "AzNeTPNbcV4Sa3ewgqpVP43ROBM"
}