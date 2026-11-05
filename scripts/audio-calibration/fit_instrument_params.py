"""Grid-fit slope / register slope / filter shift / even offset of the TS spectral model to an SF2 reference.
usage: python3 -I fit_instrument_params.py <ref.json> [name]
"""
import json, sys, itertools
import numpy as np
E = np.array([-12.5, -7.6, -2.7, 1.9, 5.2, 6.9, 7.8, 7.9, 7.5, 6.3, 3.2, -2.0, -7.8, -14.1])
START = np.log2(100.0)
def body(f, shift):
    x = (np.log2(np.maximum(20, f)) - shift - START) / 0.5
    last = len(E) - 1
    y = np.interp(x, np.arange(len(E)), E)
    y = np.where(x < 0, E[0] + x * (E[1] - E[0]), y)
    y = np.where(x > last, E[last] + (x - last) * (E[last] - E[last - 1]), y)
    return y
def model(f0, k, slope, a2, even, shift):
    lk = np.log2(k)
    return slope * lk + a2 * lk * (np.log2(f0) - np.log2(311)) + even * (k % 2 == 0) + body(f0 * k, shift)
ref = json.load(open(sys.argv[1]))
rows = []
for key in sorted(ref, key=int):
    r = ref[key]; K = min(36, len(r["harm_db"])); f0 = r["f0"]
    ks = np.array([k for k in range(1, K + 1) if k * f0 < 9500])
    if len(ks) < 6: continue
    p = 10 ** (np.array(r["harm_db"][: len(ks)]) / 10); p /= p.sum()
    rows.append((f0, ks, 10 * np.log10(p + 1e-14), p))
def err(slope, a2, even, shift):
    out = []
    for f0, ks, L, p in rows:
        m = model(f0, ks, slope, a2, even, shift)
        q = 10 ** (m / 10); q /= q.sum(); m = 10 * np.log10(q + 1e-14)
        d = m - L; w = p / p.sum()
        out.append(np.sqrt(np.sum(w * d ** 2)))
    return float(np.median(out))
best = []
for slope, a2, even, shift in itertools.product(np.arange(-9.5, -5.4, 0.5), (0.0, 1.0, 2.0, 3.0), (-1.0, 0.0, 1.0), np.arange(-0.5, 0.31, 0.1)):
    best.append((err(slope, a2, even, shift), slope, a2, even, round(float(shift), 2)))
best.sort()
print("reference:", sys.argv[1])
print("current alto-like defaults (-6.58,1.0,-0.3,0):", round(err(-6.58, 1.0, -0.3, 0.0), 2))
for b in best[:6]: print("err %.2f  slope %.1f  a2 %.1f  even %.1f  shift %.2f" % b)
