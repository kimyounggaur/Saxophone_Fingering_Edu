"""Extract per-note mp3 files from a MIDI.js soundfont .js file (base64 data URIs).

Pure text parsing; the JS is never executed.
usage: python3 -I extract_sf_js.py <in.js> <out_dir>
"""
import base64
import pathlib
import re
import sys

src = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
n = 0
for m in re.finditer(r'"([A-Ga-g][b#]?-?\d)"\s*:\s*"data:audio/mp3;base64,([A-Za-z0-9+/=]+)"', src):
    (out / f"{m.group(1)}.mp3").write_bytes(base64.b64decode(m.group(2)))
    n += 1
print(f"{out}: {n} notes")
