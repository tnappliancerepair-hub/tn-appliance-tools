// Records a Stripe subscription event + updates company.tenant_status
// when appropriate. Called by netlify/functions/stripe-subscription-webhook
// after signature verification.
query record_subscription_event verb=POST {
  api_group = "intake"

  input {
    text event_id
    text event_type
    int? company_id?
    text? customer_id_stripe?
    text? subscription_id?
    int? amount_total?
    text? status?
    text? raw_preview?
  }

  stack {
    var $audit_meta {
      value = {
        event_id          : $input.event_id
        event_type        : $input.event_type
        company_id        : ($input.company_id ?? 0)
        customer_id_stripe: ($input.customer_id_stripe ?? "")
        subscription_id   : ($input.subscription_id ?? "")
        amount_total      : ($input.amount_total ?? 0)
        status            : ($input.status ?? "")
        raw_preview       : ($input.raw_preview ?? "")
      }
    }
  
    var $audit_json {
      value = $audit_meta|json_encode
    }
  
    db.add event_log {
      data = {
        action  : "stripe_subscription_event"
        metadata: $audit_json
      }
    } as $audit_row
  
    // Flip company status when relevant
    var $new_status {
      value = ""
    }
  
    conditional {
      if ($input.event_type == "checkout.session.completed") {
        var.update $new_status {
          value = "active"
        }
      }
    
      elseif ($input.event_type == "invoice.payment_failed") {
        var.update $new_status {
          value = "past_due"
        }
      }
    
      elseif ($input.event_type == "customer.subscription.deleted") {
        var.update $new_status {
          value = "canceled"
        }
      }
    }
  
    var $updated_company_id {
      value = 0
    }
  
    conditional {
      if ($new_status != "" && ($input.company_id ? 0) > 0) {
        db.edit company {
          field_name = "id"
          field_value = $input.company_id
          data = {tenant_status: $new_status}
        } as $upd
      
        var.update $updated_company_id {
          value = $input.company_id
        }
      }
    }
  }

  response = {
    success           : true
    event_logged_id   : $audit_row.id
    updated_company_id: $updated_company_id
    new_status        : $new_status
  }

  guid = "record-subscription-event-v1"
}