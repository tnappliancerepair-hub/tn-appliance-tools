#!/usr/bin/env bash
# platform-e2e.sh — end-to-end acceptance test for the Ant platform's shop-build chain.
#
# Walks the REAL path a new shop takes and asserts at every step, then tears the shop
# down to zero residue:
#
#   /apply submit -> /applications approve -> onboard-shop -> tenant + owner login
#   + 7-seat crew pack -> every seat authenticates -> role/data integrity
#   -> add-a-tech -> offboard (logins revoked) -> purge -> residue check
#
# Usage:
#   ADMIN_SECRET=... tools/platform-e2e.sh [-n RUNS] [-k] [--ann] [--cell +1...]
#     -n RUNS     how many full builds to run back to back (default 1)
#     -k          KEEP the last shop standing (skip its teardown) so you can log in
#     --ann       ALSO stand up the Ann line (buys a real DID) — default OFF
#     --cell      owner cell for the welcome text (default: Teddy's)
#
# Exit code 0 = every check passed on every run.
set -uo pipefail

SITE="${SITE:-https://tnapplianceexchange.net}"
FN="$SITE/.netlify/functions"
SB="${SB:-https://tntbhfwitytkcoqlejwc.supabase.co}"
# Publishable (browser-safe) key — the same one platform/config.js ships. Used only to
# prove a seat can actually sign in. Never the service key.
ANON="${ANON:-sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7}"
SECRET="${ADMIN_SECRET:-${VAPI_ADMIN_SECRET:-}}"
RUNS=1; KEEP=0; ANN=0; CELL="+16154855795"

while [ $# -gt 0 ]; do
  case "$1" in
    -n) RUNS="$2"; shift 2 ;;
    -k) KEEP=1; shift ;;
    --ann) ANN=1; shift ;;
    --cell) CELL="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SECRET" ] || { echo "set ADMIN_SECRET" >&2; exit 2; }

PASS=0; FAIL=0; FAILED_NAMES=""
ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_NAMES="$FAILED_NAMES\n    - $1${2:+  ($2)}"; printf '  \033[31m✗\033[0m %s\033[31m%s\033[0m\n' "$1" "${2:+  — $2}"; }
# check NAME ACTUAL EXPECTED
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got '$2', want '$3'"; fi; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

# GET a function, print body
api()  { curl -s --max-time 60 "$FN/$1"; }

# Try to sign a seat in. echoes "ok" / "fail"
signin() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
    -X POST "$SB/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H 'content-type: application/json' \
    -d "{\"email\":$(jq -Rn --arg v "$1" '$v'),\"password\":$(jq -Rn --arg v "$2" '$v')}")
  [ "$code" = "200" ] && echo ok || echo "fail($code)"
}

run_once() {
  local RUN="$1" STAMP SLUG NAME EMAIL
  STAMP=$(date +%m%d-%H%M%S)
  NAME="Ant E2E $STAMP"
  SLUG="ant-e2e-$STAMP"
  EMAIL="e2e-$STAMP@assistant247.net"

  hdr "RUN $RUN/$RUNS — $NAME  ($SLUG)"

  # ── 1. APPLY (the public /apply form) ──────────────────────────────────────
  local APPLY APP_ID
  APPLY=$(curl -s --max-time 40 -X POST "$FN/shop-application?action=submit" \
    -H 'content-type: application/json' -d "$(jq -n \
      --arg n "$NAME" --arg e "$EMAIL" --arg c "$CELL" \
      '{name:$n,trade:"appliance",area:"Nashville, TN",owner_first:"E2E",owner_name:"E2E Tester",
        owner_email:$e,owner_cell:$c,about:"Automated end-to-end acceptance test shop.",hours:"Mon-Fri 8-5"}')")
  APP_ID=$(echo "$APPLY" | jq -r '.id // empty')
  check "application submits" "$(echo "$APPLY" | jq -r '.ok')" "true"
  [ -n "$APP_ID" ] && ok "application id returned ($APP_ID)" || { bad "application id returned" "$(echo "$APPLY" | head -c 200)"; return; }
  check "application shows in the review queue" \
    "$(api "shop-application?action=list&secret=$SECRET" | jq -r --arg i "$APP_ID" '[.applications[]?|select((.id|tostring)==$i)]|length')" "1"

  # ── 2. APPROVE (the one-tap /applications button) ──────────────────────────
  local NOANN=""; [ "$ANN" = "0" ] && NOANN="&no_ann=1"
  local APPROVE
  APPROVE=$(curl -s --max-time 120 "$FN/shop-application?action=approve&id=$APP_ID&secret=$SECRET$NOANN")
  check "approve succeeds" "$(echo "$APPROVE" | jq -r '.ok')" "true"
  local GOT_SLUG OWNER_EMAIL OWNER_PW
  GOT_SLUG=$(echo "$APPROVE" | jq -r '.slug // empty')
  OWNER_EMAIL=$(echo "$APPROVE" | jq -r '.owner_login.email // empty')
  OWNER_PW=$(echo "$APPROVE" | jq -r '.owner_login.temp_password // empty')
  # HARD STOP. Without a real slug every later call would target the literal string
  # "null" — and shoppack would happily CREATE a junk tenant called "null". Never
  # let a failed build cascade into writes against a garbage slug.
  if [ -z "$GOT_SLUG" ] || [ "$GOT_SLUG" = "null" ]; then
    bad "tenant slug returned" "$(echo "$APPROVE" | head -c 300)"
    printf '  \033[31mABORTING RUN\033[0m — no slug, refusing to touch anything downstream\n'
    return
  fi
  SLUG="$GOT_SLUG"; ok "tenant slug returned ($SLUG)"
  check "owner login is the applicant's real email" "$OWNER_EMAIL" "$EMAIL"
  [ -n "$OWNER_PW" ] && ok "owner temp password issued" || bad "owner temp password issued"
  check "every onboard step ready" "$(echo "$APPROVE" | jq -r '.steps|to_entries|map(select(.value.ok!=true))|length')" "0"
  check "application flips to approved" \
    "$(api "shop-application?action=list&secret=$SECRET" | jq -r --arg i "$APP_ID" '(.applications[]?|select((.id|tostring)==$i)).status // "missing"')" "approved"

  # ── 3. TENANT + SEAT-MODEL INTEGRITY ───────────────────────────────────────
  local CK
  CK=$(api "platform-provision?action=e2echeck&secret=$SECRET&slug=$SLUG")
  check "company row exists"            "$(echo "$CK" | jq -r '.company_exists')"        "true"
  check "7 logins created"              "$(echo "$CK" | jq -r '.app_users')"             "7"
  check "  1 owner"                     "$(echo "$CK" | jq -r '.roles.owner // 0')"      "1"
  check "  2 office"                    "$(echo "$CK" | jq -r '.roles.office // 0')"     "2"
  check "  4 tech"                      "$(echo "$CK" | jq -r '.roles.tech // 0')"       "4"
  check "4 technician rows"             "$(echo "$CK" | jq -r '.technicians')"           "4"
  check "  all linked to a tech seat"   "$(echo "$CK" | jq -r '.technicians_linked_to_tech_seat')" "4"
  check "office seats have NO tech row" "$(echo "$CK" | jq -r '.office_with_tech_row')"  "0"
  check "seed job on the board"         "$(echo "$CK" | jq -r '.jobs > 0')"              "true"
  check "pack stored in the vault"      "$(echo "$CK" | jq -r '.pack_stored')"           "true"
  check "pack holds 7 seats"            "$(echo "$CK" | jq -r '.pack.seats')"            "7"
  check "pack owner = real email"       "$(echo "$CK" | jq -r '.pack.owner_email')"      "$EMAIL"
  check "booking link minted"           "$(echo "$CK" | jq -r '.pack.booking_link')"     "https://tnapplianceexchange.net/b/$SLUG"
  check "intake email minted"           "$(echo "$CK" | jq -r '.pack.intake_email')"     "$SLUG@jobs.assistant247.net"

  # ── 4. EVERY SEAT ACTUALLY SIGNS IN ────────────────────────────────────────
  hdr "  seat logins"
  local PACK SEATS i EM PW LB R FIRST_TECH_EMAIL="" FIRST_TECH_PW=""
  PACK=$(api "platform-provision?action=packs&secret=$SECRET&slug=$SLUG")
  SEATS=$(echo "$PACK" | jq -r '.pack.seats | length // 0')
  check "pack readable via action=packs" "$SEATS" "7"
  i=0
  while [ "$i" -lt "$SEATS" ]; do
    EM=$(echo "$PACK" | jq -r ".pack.seats[$i].email")
    PW=$(echo "$PACK" | jq -r ".pack.seats[$i].password")
    LB=$(echo "$PACK" | jq -r ".pack.seats[$i].label")
    # owner-mode must have recorded the SAME temp password provision issued — not a reset one
    if [ "$(echo "$PACK" | jq -r ".pack.seats[$i].role")" = "owner" ]; then
      check "  pack recorded the owner's issued password (not a reset)" "$PW" "$OWNER_PW"
    fi
    [ -z "$FIRST_TECH_EMAIL" ] && [ "$(echo "$PACK" | jq -r ".pack.seats[$i].role")" = "tech" ] && { FIRST_TECH_EMAIL="$EM"; FIRST_TECH_PW="$PW"; }
    R=$(signin "$EM" "$PW")
    check "$LB signs in ($EM)" "$R" "ok"
    i=$((i+1))
  done

  # ── 5. ADD-A-TECH OVERFLOW ─────────────────────────────────────────────────
  hdr "  add-a-seat"
  local ADD
  ADD=$(api "platform-provision?action=addseat&secret=$SECRET&slug=$SLUG&role=tech")
  check "add a tech succeeds"     "$(echo "$ADD" | jq -r '.ok')"            "true"
  check "  it's Tech 5"           "$(echo "$ADD" | jq -r '.seat.label')"    "Tech 5"
  check "  pack grows to 8"       "$(echo "$ADD" | jq -r '.pack.seats|length')" "8"
  check "  new tech signs in"     "$(signin "$(echo "$ADD" | jq -r '.seat.email')" "$(echo "$ADD" | jq -r '.seat.password')")" "ok"
  ADD=$(api "platform-provision?action=addseat&secret=$SECRET&slug=$SLUG&role=office")
  check "add an office seat"      "$(echo "$ADD" | jq -r '.seat.label')"    "Office 3"
  check "  pack grows to 9"       "$(echo "$ADD" | jq -r '.pack.seats|length')" "9"
  check "  new office signs in"   "$(signin "$(echo "$ADD" | jq -r '.seat.email')" "$(echo "$ADD" | jq -r '.seat.password')")" "ok"
  CK=$(api "platform-provision?action=e2echeck&secret=$SECRET&slug=$SLUG")
  check "  still no tech row on office" "$(echo "$CK" | jq -r '.office_with_tech_row')" "0"
  check "  now 5 technician rows"       "$(echo "$CK" | jq -r '.technicians')"          "5"

  # ── 6. IDEMPOTENCY — a re-run must not reset or duplicate ──────────────────
  hdr "  idempotency"
  local RE
  RE=$(api "platform-provision?action=shoppack&secret=$SECRET&slug=$SLUG&office=2&techs=4")
  check "shoppack re-run succeeds"   "$(echo "$RE" | jq -r '.ok')" "true"
  check "  reuses existing logins"   "$(echo "$RE" | jq -r '[.results[]?|select(.note=="created")]|length')" "0"
  check "  original tech still signs in" "$(signin "$FIRST_TECH_EMAIL" "$FIRST_TECH_PW")" "ok"
  check "  no duplicate logins"      "$(api "platform-provision?action=e2echeck&secret=$SECRET&slug=$SLUG" | jq -r '.app_users')" "9"

  # ── 7. TEARDOWN ────────────────────────────────────────────────────────────
  if [ "$KEEP" = "1" ] && [ "$RUN" = "$RUNS" ]; then
    hdr "  teardown SKIPPED (-k) — shop left standing"
    printf '  slug: %s\n  packs: %s/packs.html\n  owner: %s / %s\n' "$SLUG" "$SITE" "$OWNER_EMAIL" "$OWNER_PW"
    return
  fi
  hdr "  teardown"
  local OFF PUR
  case "$SLUG" in ant-e2e-*) ;; *) bad "teardown safety" "refusing to tear down '$SLUG' — not an e2e slug"; return ;; esac
  OFF=$(api "platform-provision?action=offboard&secret=$SECRET&slug=$SLUG&reason=e2e+test")
  check "offboard succeeds"          "$(echo "$OFF" | jq -r '.ok')"     "true"
  check "  marked churned"           "$(echo "$OFF" | jq -r '.status')" "churned"
  check "  all 9 logins revoked"     "$(echo "$OFF" | jq -r '.logins_revoked')" "9"
  R=$(signin "$FIRST_TECH_EMAIL" "$FIRST_TECH_PW")
  if [ "$R" = "ok" ]; then bad "  revoked seat CANNOT sign in" "still signs in!"; else ok "  revoked seat CANNOT sign in ($R)"; fi
  PUR=$(api "platform-provision?action=purge&secret=$SECRET&slug=$SLUG&confirm=yes&force=yes")
  check "purge succeeds"             "$(echo "$PUR" | jq -r '.ok')" "true"
  api "platform-provision?action=packclear&secret=$SECRET&slug=$SLUG&confirm=yes" >/dev/null
  CK=$(api "platform-provision?action=e2echeck&secret=$SECRET&slug=$SLUG")
  check "  company gone"             "$(echo "$CK" | jq -r '.company_exists')" "false"
  check "  zero logins left"         "$(echo "$CK" | jq -r '.app_users')"      "0"
  check "  vault pack cleared"       "$(echo "$CK" | jq -r '.pack_stored')"    "false"
  check "  gone from tenant list"    "$(api "platform-provision?action=tenants&secret=$SECRET" | jq -r --arg s "$SLUG" '[.tenants[]?|select(.slug==$s)]|length')" "0"
}

START=$(date +%s)
r=1; while [ "$r" -le "$RUNS" ]; do run_once "$r"; r=$((r+1)); done
printf '\n\033[1m═══ %d passed, %d failed  (%ds, %d run%s) ═══\033[0m\n' \
  "$PASS" "$FAIL" "$(( $(date +%s) - START ))" "$RUNS" "$([ "$RUNS" -gt 1 ] && echo s)"
[ "$FAIL" -gt 0 ] && { printf '\033[31mfailed checks:\033[0m%b\n' "$FAILED_NAMES"; exit 1; }
printf '\033[32mplatform builds clean end to end.\033[0m\n'
