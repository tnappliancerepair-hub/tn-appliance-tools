// Notifies Danielle when Teddy flags a job for parts ordering.
// Called by the Teddy tool after TDR submission when parts_decision=ship_to_customer.
// Sends Danielle both an SMS and an email with the order details.
query notify_parts_ordered verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? part_number?
    text? supplier?
    text? eta_date?
    text? customer_name?
    text? appliance_type?
    text? brand?
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $cust
  
    var $cust_name_final {
      value = (($input.customer_name ?? "")|trim)
    }
  
    conditional {
      if ($cust_name_final == "" && $cust != null) {
        var.update $cust_name_final {
          value = (($cust.first_name ?? "")|trim) ~ " " ~ (($cust.last_name ?? "")|trim)
        }
      }
    }
  
    var $appl_final {
      value = (($input.appliance_type ?? "")|trim)
    }
  
    conditional {
      if ($appl_final == "" && $job != null) {
        var.update $appl_final {
          value = (($job.appliance_type ?? "")|trim)
        }
      }
    }
  
    var $brand_final {
      value = (($input.brand ?? "")|trim)
    }
  
    conditional {
      if ($brand_final == "" && $job != null) {
        var.update $brand_final {
          value = (($job.brand ?? "")|trim)
        }
      }
    }
  
    var $part_num_final {
      value = (($input.part_number ?? "")|trim)
    }
  
    var $supplier_final {
      value = (($input.supplier ?? "")|trim)
    }
  
    var $eta_final {
      value = (($input.eta_date ?? "")|trim)
    }
  
    var $ship_street {
      value = (($job.service_address ?? "")|trim)
    }
  
    conditional {
      if ($ship_street == "" && $cust != null) {
        var.update $ship_street {
          value = (($cust.address ?? "")|trim)
        }
      }
    }
  
    var $ship_city {
      value = (($job.service_city ?? "")|trim)
    }
  
    conditional {
      if ($ship_city == "" && $cust != null) {
        var.update $ship_city {
          value = (($cust.city ?? "")|trim)
        }
      }
    }
  
    var $ship_state {
      value = (($job.service_state ?? "")|trim)
    }
  
    var $ship_zip {
      value = (($job.service_zip ?? "")|trim)
    }
  
    var $ship_address_line {
      value = $ship_street ~ ", " ~ $ship_city ~ ", " ~ $ship_state ~ " " ~ $ship_zip
    }
  
    var $danielle_sms_body {
      value = "PARTS ORDER - Job #" ~ ($input.job_id|to_text) ~ " - " ~ $cust_name_final ~ "\n" ~ $brand_final ~ " " ~ $appl_final ~ "\nPart: " ~ $part_num_final ~ "\nSupplier: " ~ $supplier_final ~ "\nETA: " ~ $eta_final ~ "\nShip to: " ~ $ship_address_line ~ "\n\nReply ORDERED " ~ ($input.job_id|to_text) ~ " when placed."
    }
  
    var $gate_np_sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    var $gate_np_is_danielle {
      value = true
    }
  
    var $gate_np_should_send {
      value = $gate_np_sms_enabled || $gate_np_is_danielle
    }
  
    conditional {
      if ($gate_np_should_send) {
        api.request {
          url = "https://api.telnyx.com/v2/messages"
          method = "POST"
          params = {
            from: $env.TELNYX_FROM_CUSTOMER
            to  : "+16154850713"
            text: $danielle_sms_body
          }
        
          headers = [
            "Authorization: Bearer " ~ $env.TELNYX_API_KEY
            "Content-Type: application/json"
          ]
        } as $danielle_sms
      }
    }
  
    var $email_subject {
      value = "[TN Appliance] Parts Order - Job #" ~ ($input.job_id|to_text) ~ " - " ~ $cust_name_final
    }
  
    var $email_body {
      value = "Hi Danielle,\n\nTeddy has diagnosed a job and parts need to be ordered.\n\nJob #: " ~ ($input.job_id|to_text) ~ "\nCustomer: " ~ $cust_name_final ~ "\nAppliance: " ~ $brand_final ~ " " ~ $appl_final ~ "\nPart Number: " ~ $part_num_final ~ "\nSupplier: " ~ $supplier_final ~ "\nETA: " ~ $eta_final ~ "\n\nShip to customer:\n" ~ $ship_address_line ~ "\n\nWhen you have placed the order, reply ORDERED " ~ ($input.job_id|to_text) ~ " to confirm.\nTo update ETA: ETA " ~ ($input.job_id|to_text) ~ " [date]\n\n-TN Appliance Exchange automation"
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:SXH92Wk7/send_email"
      method = "POST"
      params = {
        to     : "danielle.tnappliance@gmail.com"
        subject: $email_subject
        body   : $email_body
      }
    
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $email_resp
  
    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        parts_status  : "parts_needed"
        parts_supplier: $supplier_final
        parts_eta_date: $eta_final
      }
    } as $job_updated
  
    db.add event_log {
      data = {
        action  : "notify_parts_ordered"
        metadata: {
        job_id      : $input.job_id
        part_number : $part_num_final
        supplier    : $supplier_final
        eta_date    : $eta_final
        customer    : $cust_name_final
        ship_address: $ship_address_line
      }
      }
    } as $np_log
  }

  response = {success: true}
  guid = "IG_w0JilAvw2un256luWy1wWa_M"
}