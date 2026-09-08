#!/usr/bin/env bash
# render.sh — screenshot each ad card at its exact social size via headless Chrome.
set -e
cd "$(dirname "$0")"
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
mkdir -p out
node build.js
dims() { case "$1" in sq) echo "1080,1080";; story) echo "1080,1920";; link) echo "1200,630";; esac; }
node -e 'JSON.parse(require("fs").readFileSync("manifest.json")).forEach(m=>console.log(m.id+" "+m.size))' | while read id size; do
  wh=$(dims "$size")
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$wh" --default-background-color=00000000 \
    --screenshot="out/$id.png" "file://$PWD/$id.html" >/dev/null 2>&1
  echo "  out/$id.png  ($wh)  $(node -e "const b=require('fs').readFileSync('out/$id.png');console.log(b.readUInt32BE(16)+'x'+b.readUInt32BE(20)+'  '+Math.round(b.length/1024)+'KB')")"
done
echo "done."
