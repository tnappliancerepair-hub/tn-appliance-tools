// Daily cron that queries jobs in prediagnosis_pending over 48 hours old with no tech_assist_session and sends SMS notifications to assigned techs.
query notify_stale_prediagnosis_jobs_2605230613 verb=POST {
  api_group = "intake"

  input {
  }

  stack {
  }

  response = null
  guid = "y6LoPzyDGVzGHPbptW6167hOvsE"
}