# 🎯 Cutover punch list — target Wednesday 2026-06-17

Goal: Danielle + techs living in Ant daily, phone secured, HCP/MeisterTask off.

## 1. One Mac push syncs ALL the XS work (2 min)
Front-end is already live on Netlify; these are the Xano endpoints behind it.
Run both lines (pushing already-live ones again is harmless):

```
cd ~/tn-appliance-tools && git fetch origin main && git checkout origin/main -- \
  api/intake/check_service_zone_GET.xs \
  api/intake/get_tech_route_days_GET.xs \
  api/intake/list_cluster_assignments_GET.xs \
  api/intake/set_cluster_rank_POST.xs \
  api/intake/find_extra_work_for_tech_GET.xs \
  api/intake/office_remove_job_POST.xs \
  api/intake/office_quick_fill_POST.xs \
  api/intake/lookup_customer_by_phone_GET.xs \
  api/intake/lookup_by_claim_number_POST.xs \
  api/intake/list_callback_requests_GET.xs \
  api/intake/mark_callback_handled_POST.xs \
  api/intake/list_struggled_calls_GET.xs \
  api/intake/office_universal_search_GET.xs \
  api/intake/search_customers_POST.xs \
  api/intake/voice_followup_send_links_POST.xs
```
```
/opt/homebrew/bin/xano workspace push -i "api/**/{check_service_zone,get_tech_route_days,list_cluster_assignments,set_cluster_rank,find_extra_work_for_tech,office_remove_job,office_quick_fill,lookup_customer_by_phone,lookup_by_claim_number,list_callback_requests,mark_callback_handled,list_struggled_calls,office_universal_search,search_customers,voice_followup_send_links}*" --force
```
NOTE: Xano == is CASE-SENSITIVE; names stored Title Case. Name search
(search_customers + office_universal_search) Title-Cases tokens to match.
Then kickstart the loop (for the route-fill helper):
`launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`
Ignore "table does not exist" warnings.

## 2. Phone (Vapi) — secured, just verify
- ✅ Our tools wired onto Ant Inbound (`vapi-wire-inbound.js --apply` done).
- [ ] **Test call**: give a claim/WO # (reads status + day), ask something it
      can't answer (lands in 📲 Callbacks), confirm no mis-greet.
- [ ] **transferCall** destination = a number that rings (dashboard).
- [ ] **Analysis → Summary** on (dashboard).
- Permanent caller-ID fix = port 615-280-2949 to Telnyx (blocked on 2FA;
      masked-caller guard covers it meanwhile).

## 2b. Vapi is now CODE-MANAGED (no more dashboard fights)
- Tools: `node scripts/vapi-wire-inbound.js --apply` (attaches our tool set to
  Ant Inbound, detaches dev tools).
- Prompt: `node scripts/vapi-inbound-prompt.js --pull` (capture live prompt to
  `vapi-config/prompts/ant_inbound.md` ONCE), then edit the file and
  `node scripts/vapi-inbound-prompt.js --apply` to push. Dry-run by default.
- That's the whole Vapi workflow now: edit JSON/markdown in `vapi-config/`, run
  a script. The dashboard is only for transferCall + Summary toggles.

## 3. Office (Danielle) — live, just hard-refresh
All shipped this weekend (Ctrl+Shift+R to load):
- Calendar/Schedule black screen fixed · cards stay where dropped · Move-to-
  folder · Scheduled folder · edit/add job info · markable checklist · delete
  junk · wait-age badges · oldest-first · name search (after push #1).
- [ ] Danielle hard-refreshes once after the push.

## 4. The real cutover work (data + habit) — daily through Wednesday
- [ ] Danielle schedules in Ant (Do-Next / board), enters claim# + phone +
      model as she goes -> phone lookups stop missing.
- [ ] Work the ~70 unscheduled backlog down via Do-Next (oldest first).
- [ ] Techs use tech-job / tech-ant-chat for reports (auto-fills the job).
- [ ] Area Coverage: set a real tech rank-1 per cluster (Teddy is last resort).

## 5. Watch these fall = phone getting better
`assistant-forwarded-call` + `callback_request` counts down; daily
`vapi_call_review` ⚠ STRUGGLED list shrinking; Needs-Scheduled backlog dropping.

## Keep feeding Danielle's reports
She's stress-testing the board hard (good sign). Each report -> quick fix ->
merge -> she hard-refreshes. That loop IS the cutover.
