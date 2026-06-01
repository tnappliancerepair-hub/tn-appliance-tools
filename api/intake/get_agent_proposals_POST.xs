// Returns the list of agent proposals (default: pending only), newest first.
// Backs the agent-proposals.html review page. Pass status="all" to see every
// proposal regardless of disposition.
query get_agent_proposals verb=POST {
  api_group = "intake"

  input {
    text status?
    int per_page?
  }

  stack {
    // Defensive normalization in assignment context (serializer-bug avoidance).
    var $status_filter {
      value = (($input.status ?? "pending")|trim)
    }
  
    var $page_size {
      value = ($input.per_page ?? 200)
    }
  
    conditional {
      if ($page_size <= 0) {
        var.update $page_size {
          value = 200
        }
      }
    }
  
    var $items_out {
      value = []
    }
  
    // Branch A: "all" or empty → return everything (use always-true predicate).
    conditional {
      if ($status_filter == "all" || $status_filter == "") {
        db.query agent_proposals {
          where = $db.agent_proposals.created_at > 0
          sort = {agent_proposals.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: $page_size}}
        } as $rows_all
      
        var.update $items_out {
          value = $rows_all.items
        }
      }
    }
  
    // Branch B: specific status filter.
    conditional {
      if ($status_filter != "all" && $status_filter != "") {
        db.query agent_proposals {
          where = $db.agent_proposals.status == $status_filter
          sort = {agent_proposals.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: $page_size}}
        } as $rows_filtered
      
        var.update $items_out {
          value = $rows_filtered.items
        }
      }
    }
  }

  response = {
    success      : true
    status_filter: $status_filter
    count        : $items_out|count
    items        : $items_out
  }

  guid = "jqtWS3zL0VaI7viKclrkrz1zpxg"
}