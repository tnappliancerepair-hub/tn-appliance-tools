#!/usr/bin/env bash
# kanban-perf-verify.sh — prove get_office_kanban_v2 (the `in [...]` candidate) returns
# the IDENTICAL job set as the live get_office_kanban, and is faster. Run on the Mac.
#
#   bash tools/kanban-perf-verify.sh          # time v1; time v2 if deployed; diff the sets
#
# Decision: keep v2's where-clause ONLY if it prints "SETS IDENTICAL" and v2 is faster.
set -u
B="https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA"

timeit() { curl -s -o /dev/null -w "%{time_total}s (http %{http_code})" --max-time 60 "$1"; }
idset()  { curl -s --max-time 60 "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);ids=sorted(x['id'] for x in d.get('items',[]));print('COUNT',len(ids));print('HASH',hash(tuple(ids)));import hashlib;print('SIG',hashlib.md5(','.join(map(str,ids)).encode()).hexdigest())" 2>/dev/null; }

echo "=== v1 live get_office_kanban — 3 timed runs ==="
for i in 1 2 3; do echo -n "  run$i: "; timeit "$B/get_office_kanban"; echo; done

echo "=== v2 get_office_kanban_v2 — 3 timed runs ==="
V2CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "$B/get_office_kanban_v2")
if [ "$V2CODE" != "200" ]; then
  echo "  v2 not deployed yet (http $V2CODE). Push it first:"
  echo "    xano workspace push -i \"api/**/get_office_kanban_v2*\" --force"
  exit 0
fi
for i in 1 2 3; do echo -n "  run$i: "; timeit "$B/get_office_kanban_v2"; echo; done

echo "=== SET DIFF (must be identical — same jobs, same count) ==="
echo "  -- v1 --"; V1SIG=$(idset "$B/get_office_kanban"); echo "$V1SIG" | sed 's/^/     /'
echo "  -- v2 --"; V2SIG=$(idset "$B/get_office_kanban_v2"); echo "$V2SIG" | sed 's/^/     /'
V1S=$(echo "$V1SIG" | grep SIG); V2S=$(echo "$V2SIG" | grep SIG)
if [ -n "$V1S" ] && [ "$V1S" = "$V2S" ]; then
  echo "  ✅ SETS IDENTICAL — safe to promote v2's where-clause into get_office_kanban."
else
  echo "  ❌ SETS DIFFER — do NOT promote. Discard v2 (live board is untouched)."
fi
