#!/bin/bash
# Builds the GrokGrid motion ads end to end (Node, Chromium via Playwright, ffmpeg).
#   ./make-ads.sh                         full quality, both cuts
# Output: out/grokgrid-ad-{16x9,9x16}.mp4 (launch ad) and out/grokgrid-<feature>-{16x9,9x16}.mp4
#   CUTS="main calls" ./make-ads.sh    only some videos
#   WIDE_ONLY=1 ./make-ads.sh          16:9 only
set -e
cd "$(dirname "$0")"
SECS=40
mkdir -p ui ui-dom out assets
DSF=${DSF:-2}
# WIDE_ONLY=1 skips the 9:16 cuts
SIZES=("1920 1080 16x9"); [ -n "$WIDE_ONLY" ] || SIZES+=("1080 1920 9x16")

echo "== 1/6 tools and assets"
[ -d node_modules/playwright ] || npm i --no-save --no-audit --no-fund playwright@1.49.1
npx playwright install chromium >/dev/null
command -v ffmpeg >/dev/null || brew install ffmpeg
cp ../public/fonts/*.woff2 assets/

echo "== 2/6 live UI from grokgrid.fun (markup + styles, redrawn as code in the ad)"
BASE=${BASE:-https://grokgrid.fun/} node scripts/snapshot.js "$PWD/ui-dom"

# the characters are flat, drawn in code (comp/core.js): no Blender step

python3 -m http.server 8811 --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV' EXIT
sleep 1

echo "== 4/6 soundtracks (each video's own phone-ad beat + UI sounds timed to the picture)"
CUTS=${CUTS:-main desk calls stats matrix launch burn}
dur() { grep -m1 -o 'DURATION = [0-9.]*' "comp/cuts/$1.js" | awk '{print $3}'; }
for c in $CUTS; do CUT=$c node scripts/audio.js "out/$c.wav" "$(dur $c)" > /dev/null; done

echo "== 5/6 motion design frames (drawn at ${DSF}x, two halves at once)"
for c in $CUTS; do
  D=$(dur $c); H=$(awk "BEGIN{print int($D/2)}")
  for cut in "${SIZES[@]}"; do
    set -- $cut
    DSF=$DSF QS="&ui=../ui&clips=../clips&cut=$c" node scripts/render.js $1 $2 "out/frames-$c-$3" 0 $H > "out/$c-$3-a.log" 2>&1 &
    DSF=$DSF QS="&ui=../ui&clips=../clips&cut=$c" node scripts/render.js $1 $2 "out/frames-$c-$3" $H $D > "out/$c-$3-b.log" 2>&1 &
    wait
  done
  echo "   $c"
done

echo "== 6/6 encode (supersampled down to full HD, so type and UI stay razor sharp)"
for c in $CUTS; do
  name=$([ $c = main ] && echo grokgrid-ad || echo grokgrid-$c)
  for cut in "${SIZES[@]}"; do
    set -- $cut
    ffmpeg -y -loglevel error -framerate 30 -i "out/frames-$c-$3/f_%05d.png" -i "out/$c.wav" \
      -vf "scale=$1:$2:flags=lanczos" -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p \
      -af alimiter=limit=0.89 -c:a aac -b:a 256k -shortest -movflags +faststart "out/$name-$3.mp4"
    echo "   out/$name-$3.mp4"
  done
done
