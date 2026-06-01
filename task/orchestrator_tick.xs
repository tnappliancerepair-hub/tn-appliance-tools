//  Master orchestrator cron. Ticks every 5 minutes and fires any agent
//  in agent_queue (table 37) whose next_run_at has passed. This single
//  task slot replaces individual cron slots for workflow_watcher,
//  error_hunter, revenue_optimizer, and any future agent - enabling
//  unlimited agents within Xano's 10-task plan limit.
// 
//  After this is verified working, the standalone tasks 16 (workflow_watcher)
//  and 17 (error_hunter) can be deleted to free those slots for other crons.
// 
//  Schedule: every 5 minutes (freq=300). starts_on in the past so it goes
//  live immediately on save.
task orchestrator_tick {
  stack {
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/orchestrator_tick"
      method = "POST"
      headers = ["Content-Type: application/json"]
      timeout = 300
    } as $tick_resp
  
    debug.log {
      value = "orchestrator_tick: status=" ~ ($tick_resp.response.status|to_text) ~ " body=" ~ (($tick_resp.response.result ?? {})|to_text)
    }
  }

  schedule = [{starts_on: 2026-05-22 05:00:00+0000, freq: 300}]
  guid = "UUilp_96gDjtoHwEaj6mx5lYyPU"
}