#!/bin/bash
# preview.sh <w> <h> <name> <times>  -> /home/user/ad/prev/<name>.jpg contact sheet
cd "$(dirname "$0")"
D=../prev/$3
node render.js $1 $2 $D --stills $4 > /dev/null 2>&1
python3 - "$D" "$1" "$2" "../prev/$3.jpg" <<'PY'
import sys, glob
from PIL import Image
d, w, h, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
fs = sorted(glob.glob(d + '/t_*.jpg'), key=lambda f: float(f.split('t_')[1][:-4]))
tw = 640 if w > h else 300; th = round(tw * h / w); cols = 3 if w > h else 5
ims = [Image.open(f).resize((tw, th)) for f in fs]
s = Image.new('RGB', (tw * cols, th * ((len(ims) + cols - 1) // cols)))
for i, im in enumerate(ims): s.paste(im, ((i % cols) * tw, (i // cols) * th))
s.save(out, quality=82)
PY
