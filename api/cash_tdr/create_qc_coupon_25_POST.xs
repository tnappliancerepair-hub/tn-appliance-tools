// One-shot endpoint to create the qc_credit_25 Stripe coupon (the $25 Ant's Gift /
// church / partner Quick Check credit for DIY part-only orders). Idempotent — a
// re-run returns Stripe's "resource_already_exists" which is fine.
// Mirrors create_qc_coupon (qc_credit_50). SAFE TO DELETE after verification.
query _create_qc_coupon_25 verb=POST {
  api_group = "cash_tdr"

  input {
  }

  stack {
    api.request {
      url = "https://api.stripe.com/v1/coupons"
      method = "POST"
      params = {}
        |set:"id":"qc_credit_25"
        |set:"amount_off":"2500"
        |set:"currency":"usd"
        |set:"duration":"once"
        |set:"name":"Quick Check Credit ($25)"
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

  guid = "AvGdm4kX7213IPFMrU8jUfi5VLZ"
}
