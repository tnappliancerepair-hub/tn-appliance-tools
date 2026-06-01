// Captures client-side debug events from office pages. Fire-and-forget
// from the browser via dbg() in office-dashboard.html. Lets us see
// what Danielle hit (or didn't) without bothering her for screenshots.
// Writes to event_log with action='client_debug' so we can grep by page.
query log_client_debug verb=POST {
  api_group = "intake"

  input {
    text? t?
    text? msg?
    json? data?
    text? page?
  }

  stack {
    db.add event_log {
      data = {
        action  : "client_debug"
        metadata: {
        t   : (($input.t ?? "")|trim)
        msg : (($input.msg ?? "")|trim)
        data: ($input.data ?? null)
        page: (($input.page ?? "")|trim)
      }
      }
    } as $log
  }

  response = {success: true}
  guid = "log-client-debug-v1"
}