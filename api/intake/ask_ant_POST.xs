// v0 'ask Ant anything' search endpoint. No vector store yet — pure
// keyword search across event_log + jobs + customer notes + TDR
// transcripts. Future v2: replace with pgvector/Pinecone retrieval.
query ask_ant verb=POST {
  api_group = "intake"

  input {
    text query
    int? limit?
  }

  stack {
    var $q {
      value = ($input.query ?? "")|trim|lower
    }
  
    var $lim {
      value = ($input.limit ?? 10)
    }
  
    precondition ($q != "") {
      error_type = "inputerror"
      error = "query is required"
    }
  
    // Search event_log action substrings (limited — XS lacks full-text)
    // For v1, just find by action key match.
    db.query event_log {
      where = $db.event_log.action == $q
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $event_rows
  
    // Find jobs by problem_summary exact word — v1 limitation
    db.query jobs {
      where = $db.jobs.problem_summary == $q || $db.jobs.appliance_type == $q || $db.jobs.brand == $q
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $job_rows
  }

  response = {
    success: true
    query  : $q
    matches: ```
      {
        event_log_rows : $event_rows.items
        job_rows       : $job_rows.items
      }
      ```
    note   : "v1 exact-match only. v2 vector-store retrieval planned."
  }

  guid = "ask-ant-v1"
}