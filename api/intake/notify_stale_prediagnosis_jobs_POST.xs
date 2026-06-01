// Daily cron that notifies assigned techs via SMS when jobs have been in prediagnosis_pending status for over 48 hours with no Tech Assist session started.
query notify_stale_prediagnosis_jobs verb=POST {
  api_group = "intake"

  input {
  }

  stack {
  }

  response = null
  guid = "krkcmB-xC4NZcxV1xHNEMTJku18"
}