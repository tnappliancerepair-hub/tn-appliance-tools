//  HCP polling cron — fires hcp_poll_recent_jobs endpoint every 15 min.
//  (Phase 1g+ 2026-05-07 evening.)
// 
//  Why a thin wrapper instead of replicating endpoint logic in the task:
//  the endpoint already implements the env-gate, lookback, pagination,
//  upsert, and event_log writeback. Replicating would double the code
//  surface for no benefit. The api.request adds <100ms latency vs.
//  in-process execution; a 15-min cadence cron doesn't notice.
// 
//  Disabled-by-env: the endpoint reads HCP_POLL_ENABLED and silently
//  no-ops if the flag isn't "true". The task itself runs on schedule;
//  the endpoint's gate is what controls actual work. To activate
//  production polling: set HCP_POLL_ENABLED="true" in Xano env.
// 
//  Schedule: every 15 minutes (freq: 900). starts_on set to a date in
//  the past so the cron is "live" the moment the workspace push lands;
//  the endpoint's env gate is the actual on/off switch.
task hcp_poll_recent_jobs {
  stack {
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/hcp_poll_recent_jobs"
      method = "POST"
      headers = ["Content-Type: application/json"]
      timeout = 60
    } as $poll_resp
  
    debug.log {
      value = "hcp_poll_recent_jobs cron tick: status=" ~ ($poll_resp.response.status|to_text) ~ " body=" ~ (($poll_resp.response.result ?? {})|to_text)
    }
  }

  schedule = [{starts_on: 2026-05-07 00:00:00+0000, freq: 900}]
  guid = "HcpPoll_v1_kBp4nT9wQzLm"
}