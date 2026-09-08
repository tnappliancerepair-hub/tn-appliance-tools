#!/usr/bin/env bash
set -uo pipefail
FN="https://tnapplianceexchange.net/.netlify/functions"
SB="https://tntbhfwitytkcoqlejwc.supabase.co"
ANON="sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7"
S="$ADMIN_SECRET"
P=0; F=0; FN_LIST=""
ok(){ P=$((P+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad(){ F=$((F+1)); FN_LIST="$FN_LIST\n    - $1 ($2)"; printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; }
ck(){ [ "$2" = "$3" ] && ok "$1" || bad "$1" "got '$2' want '$3'"; }
api(){ curl -s --max-time 60 "$FN/$1"; }
signin(){ c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$SB/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'content-type: application/json' -d "{\"email\":$(jq -Rn --arg v "$1" '$v'),\"password\":$(jq -Rn --arg v "$2" '$v')}"); [ "$c" = 200 ] && echo ok || echo "fail($c)"; }

ST=$(date +%m%d-%H%M%S); NM="Ant Probe $ST"
printf '\n\033[1mPROBE — %s\033[0m\n' "$NM"

R=$(api "platform-provision?action=shoppack&secret=$S&name=$(jq -rn --arg v "$NM" '$v|@uri')&office=2&techs=4&seed=1")
ck "shoppack builds the shop" "$(echo "$R"|jq -r '.ok')" "true"
SLUG=$(echo "$R"|jq -r '.slug // empty')
if [ -z "$SLUG" ] || [ "$SLUG" = null ]; then bad "slug returned" "aborting - refusing to touch a null slug"; printf '
[31mABORTED[0m %s
' "$(echo "$R"|head -c 300)"; exit 1; fi
ok "slug = $SLUG"
ck "  7 seats minted" "$(echo "$R"|jq -r '.seat_count')" "7"
ck "  all seats newly created" "$(echo "$R"|jq -r '[.results[]|select(.note=="created")]|length')" "7"
ck "  sample job seeded" "$(echo "$R"|jq -r '.seeded.ok')" "true"
ck "  pack saved to vault" "$(echo "$R"|jq -r '.saved')" "true"
ck "  booking link" "$(echo "$R"|jq -r '.pack.booking_link')" "https://tnapplianceexchange.net/b/$SLUG"
ck "  intake email" "$(echo "$R"|jq -r '.pack.intake_email')" "$SLUG@jobs.assistant247.net"

printf '\n  \033[1mseat logins\033[0m\n'
PK=$(api "platform-provision?action=packs&secret=$S&slug=$SLUG")
N=$(echo "$PK"|jq -r '.pack.seats|length'); ck "pack readable" "$N" "7"
T1E=""; T1P=""
for i in $(seq 0 $((N-1))); do
  EM=$(echo "$PK"|jq -r ".pack.seats[$i].email"); PW=$(echo "$PK"|jq -r ".pack.seats[$i].password")
  LB=$(echo "$PK"|jq -r ".pack.seats[$i].label"); RO=$(echo "$PK"|jq -r ".pack.seats[$i].role")
  [ -z "$T1E" ] && [ "$RO" = tech ] && { T1E=$EM; T1P=$PW; }
  ck "$LB signs in" "$(signin "$EM" "$PW")" "ok"
done

printf '\n  \033[1madd-a-seat\033[0m\n'
A=$(api "platform-provision?action=addseat&secret=$S&slug=$SLUG&role=tech")
ck "add tech" "$(echo "$A"|jq -r '.seat.label')" "Tech 5"
ck "  pack 7→8" "$(echo "$A"|jq -r '.pack.seats|length')" "8"
ck "  signs in" "$(signin "$(echo "$A"|jq -r '.seat.email')" "$(echo "$A"|jq -r '.seat.password')")" "ok"
A=$(api "platform-provision?action=addseat&secret=$S&slug=$SLUG&role=office")
ck "add office" "$(echo "$A"|jq -r '.seat.label')" "Office 3"
ck "  pack 8→9" "$(echo "$A"|jq -r '.pack.seats|length')" "9"
ck "  signs in" "$(signin "$(echo "$A"|jq -r '.seat.email')" "$(echo "$A"|jq -r '.seat.password')")" "ok"

printf '\n  \033[1midempotency\033[0m\n'
R=$(api "platform-provision?action=shoppack&secret=$S&slug=$SLUG&office=2&techs=4")
ck "re-run ok" "$(echo "$R"|jq -r '.ok')" "true"
ck "  creates nothing new" "$(echo "$R"|jq -r '[.results[]|select(.note=="created")]|length')" "0"
ck "  original tech password still works" "$(signin "$T1E" "$T1P")" "ok"

printf '\n  \033[1mteardown\033[0m\n'
O=$(api "platform-provision?action=offboard&secret=$S&slug=$SLUG&reason=probe")
ck "offboard" "$(echo "$O"|jq -r '.status')" "churned"
ck "  9 logins revoked" "$(echo "$O"|jq -r '.logins_revoked')" "9"
RV=$(signin "$T1E" "$T1P"); [ "$RV" = ok ] && bad "  revoked seat blocked" "still signs in" || ok "  revoked seat blocked ($RV)"
PU=$(api "platform-provision?action=purge&secret=$S&slug=$SLUG&confirm=yes&force=yes")
ck "purge" "$(echo "$PU"|jq -r '.ok')" "true"
ck "  gone from tenant list" "$(api "platform-provision?action=tenants&secret=$S"|jq -r --arg s "$SLUG" '[.tenants[]?|select(.slug==$s)]|length')" "0"

printf '\n\033[1m═══ %d passed, %d failed ═══\033[0m\n' "$P" "$F"
[ "$F" -gt 0 ] && printf '\033[31mfailures:\033[0m%b\n' "$FN_LIST"
exit 0
