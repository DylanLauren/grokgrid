#!/bin/bash
# Builds the GrokGrid motion ads end to end on a Mac with Blender installed.
#   ./make-ads.sh                         full quality, both cuts
#   SAMPLES=16 RES=540 ./make-ads.sh      quick draft
#   SKIP_CLIPS=1 ./make-ads.sh            reuse the 3D clips already in clips/
# Output: out/grokgrid-ad-16x9.mp4 and out/grokgrid-ad-9x16.mp4
set -e
cd "$(dirname "$0")"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
GPU=${GPU:-METAL}
SAMPLES=${SAMPLES:-64}
RES=${RES:-1080}
SECS=40
mkdir -p ui clips out assets

echo "== 1/5 tools and assets"
[ -d node_modules/playwright ] || npm i --no-save --no-audit --no-fund playwright@1.49.1
npx playwright install chromium >/dev/null
command -v ffmpeg >/dev/null || brew install ffmpeg
cp ../public/fonts/*.woff2 assets/

echo "== 2/5 live UI from grokgrid.fun"
BASE=${BASE:-https://grokgrid.fun/} node scripts/capture.js "$PWD/ui"

if [ -z "$SKIP_CLIPS" ]; then
  echo "== 3/5 3D clips in Blender"
  for c in hero phone lineup lineup_v family_run; do
    "$BLENDER" -b --python scripts/chars.py -- --clip $c --res $RES --samples $SAMPLES --gpu $GPU \
      --phone-tex "$PWD/ui/m-matrix-full.png" --out "$PWD/clips/$c" > "clips/$c.log" 2>&1
    echo "   $c: $(ls clips/$c | wc -l | tr -d ' ') frames"
  done
fi

python3 -m http.server 8811 --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV' EXIT
sleep 1

echo "== 4/5 soundtrack (UI sounds timed to the picture)"
node scripts/audio.js out/soundtrack.wav $SECS

echo "== 5/5 motion design frames + encode"
for cut in "1920 1080 16x9" "1080 1920 9x16"; do
  set -- $cut
  QS="&ui=../ui&clips=../clips" node scripts/render.js $1 $2 "out/frames-$3"
  ffmpeg -y -loglevel error -framerate 30 -i "out/frames-$3/f_%05d.png" -i out/soundtrack.wav \
    -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -af alimiter=limit=0.89 -c:a aac -b:a 192k -shortest -movflags +faststart "out/grokgrid-ad-$3.mp4"
  echo "   out/grokgrid-ad-$3.mp4"
done
