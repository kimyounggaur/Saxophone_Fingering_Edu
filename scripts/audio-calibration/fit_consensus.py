"""Fit the spectral parameters of an instrument to the *consensus* of two SF2 references (min of the worse one).
usage: python3 -I fit_consensus.py <refA.json> <refB.json> [slope,a2,even,shift]   (optional: the current profile, to compare)
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
def load(path):
    ref = json.load(open(path)); rows = []
    for key in sorted(ref, key=int):
        r = ref[key]; K = min(36, len(r["harm_db"])); f0 = r["f0"]
        ks = np.array([k for k in range(1, K + 1) if k * f0 < 9500])
        if len(ks) < 6: continue
        p = 10 ** (np.array(r["harm_db"][: len(ks)]) / 10); p /= p.sum()
        rows.append((f0, ks, 10 * np.log10(p + 1e-14), p))
    return rows
def err(rows, slope, a2, even, shift):
    out = []
    for f0, ks, L, p in rows:
        m = model(f0, ks, slope, a2, even, shift)
        q = 10 ** (m / 10); q /= q.sum(); m = 10 * np.log10(q + 1e-14)
        d = m - L; w = p / p.sum()
        out.append(np.sqrt(np.sum(w * d ** 2)))
    return float(np.median(out))
A, B = load(sys.argv[1]), load(sys.argv[2])
res = []
for slope, a2, even, shift in itertools.product(np.arange(-9.5, -4.9, 0.5), (1.0, 2.0, 2.3, 3.0, 4.0, 5.0), (-1.0, -0.5, 0.0), np.arange(-0.1, 0.46, 0.05)):
    ea, eb = err(A, slope, a2, even, shift), err(B, slope, a2, even, shift)
    res.append((max(ea, eb), (ea + eb) / 2, ea, eb, slope, a2, even, round(float(shift), 2)))
res.sort()
if len(sys.argv) > 3:
    cur = [float(v) for v in sys.argv[3].split(",")]
    print("current profile", cur, "-> error vs A, B:", [round(err(X, *cur), 2) for X in (A, B)])
print("max   mean  A     B     slope a2  even shift")
for r in res[:10]: print("%.2f  %.2f  %.2f  %.2f  %.1f  %.1f  %.1f  %.2f" % r)
