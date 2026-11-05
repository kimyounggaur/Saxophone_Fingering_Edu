import sys, pathlib
import numpy as np, scipy.io.wavfile as wf
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from analyze_ref import name_to_midi
def aw(f):
    f2 = f*f; c = 12194.0**2
    ra = c*f2*f2/((f2+20.6**2)*np.sqrt((f2+107.7**2)*(f2+737.9**2))*(f2+c))
    return ra*1.2589
def stats(path, t0=0.3, t1=1.0):
    sr, x = wf.read(path); x = x.astype(np.float64)
    if x.ndim > 1: x = x.mean(1)
    seg = x[int(t0*sr): int(t1*sr)]
    n = len(seg); X = np.fft.rfft(seg*np.hanning(n)); f = np.fft.rfftfreq(n, 1/sr)
    w = np.hanning(n); norm = np.sqrt(np.sum(w**2))
    A = np.sqrt(np.sum((np.abs(X)*aw(f))**2)*2)/ (n*0.612) # approx rms (hann coherent gain ~0.5)
    plain = np.sqrt(np.mean(seg**2))
    return 20*np.log10(plain+1e-12), 20*np.log10(A+1e-12), np.abs(x).max()
for d in sys.argv[1:]:
    rows = []
    for p in sorted(pathlib.Path(d).glob("*.wav"), key=lambda q: int(q.stem) if q.stem.isdigit() else 0):
        m = name_to_midi(p.stem)
        if m is None or not 49 <= m <= 80: continue
        rows.append((m,) + stats(str(p)))
    rows = np.array(rows)
    print(f"{d}: plain RMS dB median {np.median(rows[:,1]):.1f} (sd {rows[:,1].std():.1f}, range {rows[:,1].min():.1f}..{rows[:,1].max():.1f}) | A-weighted dB median {np.median(rows[:,2]):.1f} (sd {rows[:,2].std():.1f}, range {rows[:,2].min():.1f}..{rows[:,2].max():.1f}) | peak max {rows[:,3].max():.2f}")
