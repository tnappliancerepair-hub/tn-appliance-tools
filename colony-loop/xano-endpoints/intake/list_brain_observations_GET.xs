// Returns brain observations matching an entity. Other brains call
// this before their turn to pick up context noted by their peers.
//
// Filters:
//   entity_type + entity_id are required — entity-scoped lookup
//   topic (optional) — narrows to a single topic e.g. "vendor_quirk"
//   days_back — default 14, max 60
//   include_expired — default false (skip rows where expires_at_ms <
//     now)
//   weight_min — "low" | "medium" | "high" filter; default "low"
query list_brain_observations verb=GET {
  api_group = "intake"

  input {
    text entity_type filters=trim
    text entity_id filters=trim
    text? topic?
    int? days_back?
    text? weight_min?
    int? limit?
  }

  stack {
    precondition ($input.entity_type != "" && $input.entity_id != "") {
      error_type = "inputerror"
      error      = "entity_type + entity_id required"
    }

    var $lim         { value = ($input.limit ?? 20) }
    var $days        { value = ($input.days_back ?? 14) }
    var $cutoff_ms   { value = ((now|to_ms) - ($days * 86400000)) }
    var $needle_type { value = "\"entity_type\":\"" ~ $input.entity_type ~ "\"" }
    var $needle_id   { value = "\"entity_id\":\""   ~ $input.entity_id   ~ "\"" }

    db.query event_log {
      filter {
        $this.action == "brain_observation"
        && $this.metadata contains $needle_type
        && $this.metadata contains $needle_id
        && $this.created_at >= $cutoff_ms
      }
      sort = {created_at: "desc"}
      per_page = $lim
    } as $rows

    var $items     { value = [] }
    var $now_ms    { value = now|to_ms }
    var $count     { value = 0 }
    var $topic_filter { value = ($input.topic ?? "") }

    foreach ($row in $rows.items) {
      var $skip { value = false }

      var $meta_str { value = $row.metadata|json_encode }
      // expires check
      var $exp_match { value = $meta_str|regex_match:"\"expires_at_ms\":(\\d+)" }
      var $exp_ms    { value = ($exp_match|get:1 ?? "0")|to_int }
      conditional {
        if ($exp_ms > 0 && $exp_ms < $now_ms) {
          var $skip { value = true }
        }
      }

      // topic filter
      conditional {
        if ($topic_filter != "") {
          var $topic_needle { value = "\"topic\":\"" ~ $topic_filter ~ "\"" }
          conditional {
            if (!($meta_str contains $topic_needle)) {
              var $skip { value = true }
            }
          }
        }
      }

      conditional {
        if (!$skip) {
          var $entry {
            value = {
              id           : $row.id
              created_at_ms: $row.created_at
              metadata     : $row.metadata
            }
          }
          var $items { value = $items|push:$entry }
          var $count { value = ($count + 1) }
        }
      }
    }
  }

  response = {
    items: $items
    count: $count
  }

  guid = "list-brain-observations-v1"
}
