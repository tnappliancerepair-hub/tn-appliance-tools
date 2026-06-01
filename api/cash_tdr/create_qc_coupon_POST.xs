// One-shot endpoint to create the qc_credit_50 Stripe coupon. Idempotent —
// re-runs return Stripe's "resource_already_exists" error which is fine.
// Per Phase 1c step 3d.2 spec: do NOT inline coupon creation into
// qc_create_checkout_session (would fire on every checkout).
// SAFE TO DELETE after verification.
query _create_qc_coupon verb=POST {
  api_group = "cash_tdr"

  input {
  }

  stack {
    api.request {
      url = "https://api.stripe.com/v1/coupons"
      method = "POST"
      params = {}
        |set:"id":"qc_credit_50"
        |set:"amount_off":"5000"
        |set:"currency":"usd"
        |set:"duration":"once"
        |set:"name":"Quick Check Credit"
      headers = [
        "Authorization: Bearer " ~ $env.STRIPE_SECRET_KEY
        "Content-Type: application/x-www-form-urlencoded"
      ]
    
    } as $resp
  }

  response = {
    http_status: $resp.response.status
    body       : $resp.response.result
  }

  guid = "AvGdm4kX7213IPFMrU8jUfi5VLY"
}