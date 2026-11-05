"""Fit a linear source-filter model to measured sax harmonic profiles.

  L[m,k] = c_m + a*log2(k) + a2*log2(k)*(log2 f0_m - log2 311) + b*[k even] + E(log2(k*f0_m))

E is piecewise-linear in log2(frequency) (hat basis, knots every half octave) with a
second-difference smoothness penalty.  c_m are per-note nuisance offsets.

usage: python3 -I fit_spectrum.py <out.json> <set1.json:weight> [<set2.json:weight> ...]
Prints cross-validation error (fit on others, test on held-out) and writes the fitted model.
"""
import json
import sys

import numpy as np

KNOTS = np.arange(np.log2(100.0), np.log2(11000.0) + 1e-9, 0.5)
LAM = 4.0
KMAX = 36
FMAX = 9500.0


def hat(x):
    """Return a (len(x), len(KNOTS)) hat-basis matrix for log2-frequency x (clamped)."""
    x = np.clip(x, KNOTS[0], KNOTS[-1])
    B = np.zeros((len(x), len(KNOTS)))
    idx = np.clip(np.searchsorted(KNOTS, x) - 1, 0, len(KNOTS) - 2)
    t = (x - KNOTS[idx]) / (KNOTS[idx + 1] - KNOTS[idx])
    B[np.arange(len(x)), idx] = 1 - t
    B[np.arange(len(x)), idx + 1] = t
    return B


def norm_db(h):
    p = 10 ** (np.array(h) / 10)
    p = p / p.sum()
    return 10 * np.log10(p + 1e-14), p


def rows_for(data):
    out = []
    for key in sorted(data, key=int):
        r = data[key]
        K = min(KMAX, len(r["harm_db"]))
        f0 = r["f0"]
        ks = np.array([k for k in range(1, K + 1) if k * f0 < FMAX])
        if len(ks) < 6:
            continue
        L, p = norm_db(r["harm_db"][: len(ks)])
        out.append((int(key), f0, ks, L, p))
    return out


def design(rows, offsets):
    X, y, w = [], [], []
    for n, (midi, f0, ks, L, p) in enumerate(rows):
        lf0 = np.log2(f0)
        base = np.zeros((len(ks), 3 + len(KNOTS) + len(rows)))
        base[:, 0] = np.log2(ks)
        base[:, 1] = np.log2(ks) * (lf0 - np.log2(311.0))
        base[:, 2] = (ks % 2 == 0).astype(float)
        base[:, 3: 3 + len(KNOTS)] = hat(np.log2(ks * f0))
        base[:, 3 + len(KNOTS) + n] = 1.0
        X.append(base)
        y.append(L)
        wt = np.sqrt(p / p.max()) * 0.9 + 0.1
        w.append(wt)
    return np.vstack(X), np.concatenate(y), np.concatenate(w)


def fit(rows):
    X, y, w = design(rows, None)
    nP = 3 + len(KNOTS)
    # smoothness penalty on E
    D = np.zeros((len(KNOTS) - 2, X.shape[1]))
    for i in range(len(KNOTS) - 2):
        D[i, 3 + i], D[i, 4 + i], D[i, 5 + i] = 1, -2, 1
    # identifiability: E has zero mean and zero linear trend over its knots
    C = np.zeros((2, X.shape[1]))
    j = np.arange(len(KNOTS), dtype=float)
    C[0, 3: 3 + len(KNOTS)] = 1.0
    C[1, 3: 3 + len(KNOTS)] = j - j.mean()
    A = np.vstack([X * w[:, None], LAM * D, 100.0 * C])
    b = np.concatenate([y * w, np.zeros(D.shape[0]), np.zeros(2)])
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    return sol[:nP]


def predict(theta, f0, ks):
    lf0 = np.log2(f0)
    a, a2, bb = theta[0], theta[1], theta[2]
    E = theta[3:]
    return a * np.log2(ks) + a2 * np.log2(ks) * (lf0 - np.log2(311.0)) + bb * (ks % 2 == 0) + hat(np.log2(ks * f0)) @ E


def evaluate(theta, rows):
    werr, ferr = [], []
    for midi, f0, ks, L, p in rows:
        pr = predict(theta, f0, ks)
        # normalise prediction like the measurement (total power = 1)
        q = 10 ** (pr / 10)
        q = q / q.sum()
        pr = 10 * np.log10(q + 1e-14)
        d = pr - L
        w = p / p.sum()
        werr.append(np.sqrt(np.sum(w * d ** 2)))
        sel = L > L.max() - 40
        ferr.append(np.sqrt(np.mean(d[sel] ** 2)))
    return float(np.median(werr)), float(np.median(ferr))


def main():
    out = sys.argv[1]
    sets = []
    for spec in sys.argv[2:]:
        path, wgt = spec.split(":")
        sets.append((path, float(wgt), rows_for(json.load(open(path)))))
    print("held-out validation (power-weighted RMS dB / within-40dB RMS dB):")
    for i, (path, _, rows_i) in enumerate(sets):
        train = [r for j, (_, _, rr) in enumerate(sets) if j != i for r in rr]
        if not train:
            continue
        th = fit(train)
        print(f"  fit on others -> test {path.split('/')[-1]:22s}: {evaluate(th, rows_i)}")
    allrows = [r for (_, _, rr) in sets for r in rr]
    th = fit(allrows)
    for path, _, rr in sets:
        print(f"  fit on all   -> {path.split('/')[-1]:22s}: {evaluate(th, rr)}")
    json.dump({"knots_log2": KNOTS.tolist(), "a": th[0], "a2": th[1], "even": th[2], "E": th[3:].tolist()}, open(out, "w"))
    print("a (log2 k slope dB/oct-of-k) =", round(th[0], 2), " a2 =", round(th[1], 2), " even offset dB =", round(th[2], 2))
    print("E(f) dB at knots:")
    for kn, e in zip(KNOTS, th[3:]):
        print(f"  {2 ** kn:8.0f} Hz  {e:6.1f}")


if __name__ == "__main__":
    main()
