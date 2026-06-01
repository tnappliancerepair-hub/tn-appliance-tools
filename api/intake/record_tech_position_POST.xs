//  Tech-side geolocation ping. Called every 30s by tech-ant-live.html
//  while the tech is en-route ("On My Way" tapped). Stores position
//  in event_log with action='tech_position_ping' so we don't need a
//  dedicated table for v0 — promotable to a real tech_position table
//  later if/when query volume justifies it.
// 
//  Inputs: tech_id, job_id, lat, lng, optional accuracy_m + speed_mps.
//  Lightweight: no auth (tech-side, internal), just records the row.
query record_tech_position verb=POST {
  api_group = "intake"

  input {
    int tech_id
    int job_id
    text lat
    text lng
    text? accuracy_m?
    text? speed_mps?
    text? heading_deg?
  }

  stack {
    var $tid {
      value = ($input.tech_id ?? 0)
    }
  
    var $jid {
      value = ($input.job_id ?? 0)
    }
  
    var $lat_str {
      value = (($input.lat ?? "")|trim)
    }
  
    var $lng_str {
      value = (($input.lng ?? "")|trim)
    }
  
    precondition ($tid > 0 && $jid > 0 && $lat_str != "" && $lng_str != "") {
      error_type = "inputerror"
      error = "tech_id + job_id + lat + lng required"
    }
  
    db.add event_log {
      data = {
        action  : "tech_position_ping"
        metadata: {
        tech_id    : $tid
        job_id     : $jid
        lat        : $lat_str
        lng        : $lng_str
        accuracy_m : (($input.accuracy_m ?? "")|trim)
        speed_mps  : (($input.speed_mps ?? "")|trim)
        heading_deg: (($input.heading_deg ?? "")|trim)
        source     : "tech-ant-live"
      }
      }
    } as $ping_log
  }

  response = {success: true, event_id: $ping_log.id}
  guid = "record-tech-position-v1"
}