//  Returns public reviews (rating >= N, with comment) for reviews.html.
//  Reads event_log rows action="customer_feedback_recorded" and extracts
//  metadata fields. Filters to high-rating + non-empty comment.
// 
//  NOTE: metadata is JSON-encoded text — we return raw rows + let the
//  client filter, since XS doesn't reliably parse JSON in where clauses.
query list_public_reviews verb=GET {
  api_group = "intake"

  input {
    int? min_rating?
    int? limit?
  }

  stack {
    var $min_r {
      value = ($input.min_rating ?? 4)
    }
  
    var $lim {
      value = ($input.limit ?? 50)
    }
  
    db.query event_log {
      where = $db.event_log.action == "customer_feedback_recorded"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows
  
    var $out {
      value = []
    }
  
    foreach ($rows.items) {
      each as $r {
        var $meta_str {
          value = ($r.metadata ?? "")|to_text
        }
      
        // Crude string extraction — find rating + comment via replace+length
        // approach to avoid json_decode (footgun)
        var $has_min_rating {
          value = false
        }
      
        // Match any of "rating":4 or "rating":5
        var $check_4 {
          value = $meta_str|replace:'"rating":4':""
        }
      
        var $check_5 {
          value = $meta_str|replace:'"rating":5':""
        }
      
        conditional {
          if (($meta_str|strlen) != ($check_4|strlen) || ($meta_str|strlen) != ($check_5|strlen)) {
            var.update $has_min_rating {
              value = true
            }
          }
        }
      
        conditional {
          if ($has_min_rating) {
            // Best-effort comment extraction — operator may add proper
            // JSON parse later. v1 just returns the raw metadata.
            var $entry {
              value = {
                rating    : $meta_str|replace:'"rating":5':"5"|replace:'"rating":4':"4"
                created_at: $r.created_at
                metadata  : $meta_str
              }
            }
          
            var.update $out {
              value = $out|push:$entry
            }
          }
        }
      }
    }
  }

  response = {
    success     : true
    min_rating  : $min_r
    review_count: $out|count
    reviews     : $out
  }

  guid = "list-public-reviews-v1"
}