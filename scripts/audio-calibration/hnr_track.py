"""Harmonic-to-noise ratio (autocorrelation) at several times after onset, per note.
usage: python3 -I hnr_track.py <wav_dir> <lo> <hi> [out.json]
"""
import sys, pathlib, json
import numpy as np, scipy.io.wavfile as wf
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from analyze_ref import name_to_midi, rms_env

TIMES = (0.005, 0.015, 0.03, 0.05, 0.08, 0.15, 0.3, 0.6)
wav_dir, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
res = {}
for p in sorted(pathlib.Path(wav_dir).glob("*.wav")):
    m = name_to_midi(p.stem)
    if m is None or not (lo <= m <= hi): continue
    sr, x = wf.read(str(p)); x = x.astype(np.float64)
    if x.ndim > 1: x = x.mean(1)
    env, hop = rms_env(x, sr); db = 20*np.log10(env/env.max()+1e-9); t_on = int(np.argmax(db>-40))*hop
    f0 = 440*2**((m-69)/12); T = int(round(sr/f0))
    row = {}
    for tt in TIMES:
        # window long enough for 3 periods, min 25 ms
        n = max(int(0.025*sr), 3*T)
        a = int((t_on+tt)*sr); seg = x[a:a+n]
        if len(seg) < n or np.sqrt(np.mean(seg**2)) < 1e-6: continue
        seg = seg - seg.mean(); w = np.hanning(n)
        s = seg*w
        ac = np.correlate(s, s, "full")[n-1:]
        ac = ac/(ac[0]+1e-20)
        lo_l, hi_l = int(T*0.93), min(int(T*1.07), n-1)
        r = ac[lo_l:hi_l].max()
        # correct for window taper (hann autocorrelation at lag T)
        wac = np.correlate(w, w, "full")[n-1:]; wac = wac/wac[0]
        r = min(0.999, max(1e-3, r/wac[T] if T < n else r))
        row[str(tt)] = float(10*np.log10(r/(1-r)))
    res[str(m)] = row
if len(sys.argv) > 4: json.dump(res, open(sys.argv[4], "w"))
print(f"{wav_dir}: HNR dB (autocorr) median over {len(res)} notes")
print("  t after onset (ms): " + "  ".join(f"{int(t*1000):4d}" for t in TIMES))
print("  median HNR dB      : " + "  ".join(f"{np.median([r[str(t)] for r in res.values() if str(t) in r]):4.1f}" for t in TIMES))
