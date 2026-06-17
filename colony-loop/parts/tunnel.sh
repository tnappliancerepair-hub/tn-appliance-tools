#!/usr/bin/env bash
# tunnel.sh — exposes the local parts daemon (serve.js) to the cloud via a free
# Cloudflare quick-tunnel, and registers the public URL so parts-lookup-direct
# can reach it. Run this ALONGSIDE serve.js, leave it open (like the daemon).
#
#   cd colony-loop/parts && ./tunnel.sh
#
# First time only: install cloudflared ->  brew install cloudflared
set -euo pipefail
cd "$(dirname "$0")"

REGISTER_URL="https://tnapplianceexchange.net/.netlify/functions/register-parts-daemon"
SECRET="tn-parts-daemon-2026"

# 1) find the daemon's actual port (it auto-hops if 8787 is busy)
PORT="$(cat .daemon-port 2>/dev/null || echo 8787)"
echo "→ daemon port: $PORT"

if ! curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "⚠ serve.js doesn't seem to be answering on 127.0.0.1:$PORT — start it first (node serve.js)."
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "✗ cloudflared not installed. Run:  brew install cloudflared   then re-run ./tunnel.sh"
  exit 1
fi

LOG="$(mktemp -t parts-tunnel)"
echo "→ opening Cloudflare tunnel to http://127.0.0.1:$PORT ..."
cloudflared tunnel --url "http://127.0.0.1:$PORT" >"$LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null || true; rm -f "$LOG"' EXIT

# 2) wait for the public URL to appear, then register it
PUBLIC=""
for i in $(seq 1 30); do
  PUBLIC="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$PUBLIC" ] && break
  sleep 1
done

if [ -z "$PUBLIC" ]; then
  echo "✗ Couldn't read the tunnel URL. Log:"; cat "$LOG"; exit 1
fi

echo "✓ tunnel up: $PUBLIC"
RESP="$(curl -s -X POST "$REGISTER_URL" -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\",\"url\":\"$PUBLIC\"}" || true)"
echo "→ registered with cloud: $RESP"
echo ""
echo "✅ Live. The cloud will now reach the daemon directly (parts-lookup-direct)."
echo "   Leave this window open. Ctrl-C to stop the tunnel."

# 3) keep alive; re-register if Cloudflare rotates the URL
LAST="$PUBLIC"
while kill -0 "$CF_PID" 2>/dev/null; do
  sleep 30
  NOW="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)"
  if [ -n "$NOW" ] && [ "$NOW" != "$LAST" ]; then
    echo "→ tunnel URL changed, re-registering: $NOW"
    curl -s -X POST "$REGISTER_URL" -H 'Content-Type: application/json' -d "{\"secret\":\"$SECRET\",\"url\":\"$NOW\"}" >/dev/null || true
    LAST="$NOW"
  fi
done
echo "tunnel exited."
