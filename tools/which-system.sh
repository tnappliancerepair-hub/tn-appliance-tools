#!/usr/bin/env bash
# which-system.sh — answer "Xano or Supabase?" for a file, page, or search term.
#
# There are two Ant systems in this repo with OVERLAPPING FILENAMES (tech.html and
# office-board.html exist in both). Opening the wrong one looks completely plausible
# and wastes a session — it happened on 2026-09-08 during a live outage. Run this first.
#
#   tools/which-system.sh tech.html          # every match, per system
#   tools/which-system.sh platform/tech.html # one file
#   tools/which-system.sh job_tdr            # which system owns a table/term
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
Q="${1:-}"; [ -n "$Q" ] || { echo "usage: tools/which-system.sh <file|page|term>"; exit 2; }
R=$'\033[31m'; G=$'\033[32m'; B=$'\033[1m'; N=$'\033[0m'

verdict() { # $1 = path
  local f="$1" x s
  x=$(grep -c "xano\.io" "$f" 2>/dev/null | head -1); x=${x:-0}
  s=$(grep -cE "supabase|PLATFORM_SUPABASE|_lib/supabase" "$f" 2>/dev/null | head -1); s=${s:-0}
  if [ "$x" -gt 0 ] && [ "$s" -gt 0 ]; then echo "${B}BRIDGE${N} (touches BOTH — edit only on purpose)"
  elif [ "$s" -gt 0 ]; then echo "${G}SUPABASE${N} — the NEW system"
  elif [ "$x" -gt 0 ]; then echo "${R}XANO${N} — the OLD system (live daily ops)"
  elif [[ "$f" == platform/* ]]; then echo "${G}SUPABASE${N} — the NEW system (by location)"
  else echo "${R}XANO${N} — the OLD system (by location)"; fi
}

# an explicit path -> answer directly
case "$Q" in */*) if [ -f "$Q" ]; then printf "  %-42s %s\n" "$Q" "$(verdict "$Q")"; exit 0; fi ;; esac

# filename in either tree?
FOUND=0
for c in "$Q" "platform/$Q"; do
  [ -f "$c" ] && { printf "  %-42s %s\n" "$c" "$(verdict "$c")"; FOUND=1; }
done
[ "$FOUND" = 1 ] && { echo; echo "  ${B}Both exist? Then ASK which system the person means.${N}"; exit 0; }

# otherwise treat it as a search term
echo "  Files mentioning '${Q}':"
grep -rl --include=*.html --include=*.js "$Q" . 2>/dev/null \
  | grep -vE 'node_modules|/docs/|CLAUDE.md' | head -12 \
  | while read -r f; do printf "  %-42s %s\n" "$f" "$(verdict "$f")"; done
