"""Spectrum of the first part of the note relative to the sustained part, in 1/2-octave bands.
usage: python3 -I attack_spec.py <wav_dir> <lo> <hi> [t_a0=0.0 t_a1=0.04]
"""
import sys, pathlib
import numpy as np, scipy.io.wavfile as wf
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from analyze_ref import name_to_midi, rms_env
wav_dir, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
a0 = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
a1 = float(sys.argv[5]) if len(sys.argv) > 5 else 0.04
edges = 100 * 2 ** (np.arange(0, 7.01, 0.5))
rows = []
for p in sorted(pathlib.Path(wav_dir).glob("*.wav")):
    m = name_to_midi(p.stem)
    if m is None or not (lo <= m <= hi): continue
    sr, x = wf.read(str(p)); x = x.astype(np.float64)
    if x.ndim > 1: x = x.mean(1)
    env, hop = rms_env(x, sr); db = 20*np.log10(env/env.max()+1e-9); t_on = int(np.argmax(db>-40))*hop
    def band_db(t0, t1):
        seg = x[int((t_on+t0)*sr): int((t_on+t1)*sr)]
        n = len(seg)
        if n < 64: return None
        P = np.abs(np.fft.rfft(seg*np.hanning(n), 8192))**2
        f = np.arange(len(P))*sr/8192
        out = []
        for lo_, hi_ in zip(edges[:-1], edges[1:]):
            out.append(P[(f>=lo_)&(f<hi_)].sum())
        out = np.array(out)
        return 10*np.log10(out/ out.sum() + 1e-12)
    a = band_db(a0, a1); s = band_db(0.3, 0.6)
    if a is None or s is None: continue
    rows.append(a - s)
rows = np.array(rows)
print(f"{wav_dir}  early[{a0*1000:.0f}-{a1*1000:.0f} ms] minus sustain, dB re total (median over {len(rows)} notes)")
print(" ".join(f"{int(np.sqrt(l*h)):>5d}" for l, h in zip(edges[:-1], edges[1:])))
print(" ".join(f"{v:5.1f}" for v in np.median(rows, axis=0)))
