"""Compare a test render (v2/v3) against a reference measurement set.
usage: python3 -I compare.py <ref.json> <test.json> [maxK=30] [--rows]
"""
import json, sys
import numpy as np

ref = json.load(open(sys.argv[1]))
tst = json.load(open(sys.argv[2]))
maxK = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 30
rows = "--rows" in sys.argv

def norm_db(h):
    p = 10 ** (np.array(h) / 10)
    p = p / p.sum()
    return 10 * np.log10(p + 1e-14), p

keys = sorted(set(ref) & set(tst), key=int)
tot = {"werr": [], "ferr": [], "bias": [], "cent_ratio": [], "cents": [], "rise": [], "t90": [], "ratio_early": [], "inh": {}}
if rows:
    print("midi  wRMS  RMS40  bias   centroid(ref->test)  cents  rise(ref->test)  early/steady centroid(ref,test)")
for k in keys:
    r, t = ref[k], tst[k]
    K = min(maxK, len(r["harm_db"]), len(t["harm_db"]))
    rd, rp = norm_db(r["harm_db"][:K])
    td, tp = norm_db(t["harm_db"][:K])
    d = td - rd
    w = rp / rp.sum()
    werr = float(np.sqrt(np.sum(w * d ** 2)))
    sel = rd > (rd.max() - 40)
    ferr = float(np.sqrt(np.mean(d[sel] ** 2)))
    bias = float(np.sum(w * d))
    cr = t["harm_centroid_hz"] / r["harm_centroid_hz"]
    tot["werr"].append(werr); tot["ferr"].append(ferr); tot["bias"].append(bias); tot["cent_ratio"].append(cr)
    tot["cents"].append(t["cents_off"])
    tot["rise"].append((r["rise_10_90_s"], t["rise_10_90_s"]))
    tot["t90"].append((r["t_to_90_s"], t["t_to_90_s"]))
    ce_r, ce_t = r["centroid_track_hz"], t["centroid_track_hz"]
    er = ce_r.get("0.01", np.nan) / ce_r.get("0.06", np.nan)
    et = ce_t.get("0.01", np.nan) / ce_t.get("0.06", np.nan)
    tot["ratio_early"].append((er, et))
    for reg in ("0-1000", "1000-3000", "3000-6000", "6000-10000"):
        if reg in r["inharm_db_by_region"] and reg in t["inharm_db_by_region"]:
            tot["inh"].setdefault(reg, []).append((r["inharm_db_by_region"][reg], t["inharm_db_by_region"][reg]))
    if rows:
        print(f"{k:>3} {werr:5.1f} {ferr:6.1f} {bias:6.1f}  {r['harm_centroid_hz']:6.0f}->{t['harm_centroid_hz']:6.0f}  {t['cents_off']:5.1f}  {r['rise_10_90_s']*1000:4.0f}->{t['rise_10_90_s']*1000:4.0f}ms  {er:4.2f},{et:4.2f}")

def med(x): return float(np.median(x))
print(f"notes compared: {len(keys)}  (K<= {maxK})")
print(f"harmonic-profile error  power-weighted RMS: median {med(tot['werr']):.2f} dB  (mean {np.mean(tot['werr']):.2f}); within-40dB RMS: median {med(tot['ferr']):.2f} dB")
print(f"weighted bias (test-ref) median {med(tot['bias']):+.2f} dB")
cr = np.array(tot["cent_ratio"])
print(f"harmonic centroid ratio test/ref: median {np.median(cr):.2f}  range {cr.min():.2f}-{cr.max():.2f}  |log2| median {np.median(np.abs(np.log2(cr))):.2f} oct")
print(f"pitch error (test vs 12-TET) cents: median abs {np.median(np.abs(tot['cents'])):.1f}  max abs {np.max(np.abs(tot['cents'])):.1f}")
rr = np.array(tot["rise"]) * 1000
print(f"rise 10-90 ms: ref median {np.median(rr[:,0]):.0f}  test median {np.median(rr[:,1]):.0f}")
t9 = np.array(tot["t90"]) * 1000
print(f"time to 90% ms: ref median {np.median(t9[:,0]):.0f}  test median {np.median(t9[:,1]):.0f}")
er = np.array(tot["ratio_early"])
print(f"centroid(10ms)/centroid(60ms): ref median {np.nanmedian(er[:,0]):.2f}  test median {np.nanmedian(er[:,1]):.2f}")
for reg, v in tot["inh"].items():
    v = np.array(v)
    print(f"between-harmonic floor {reg:>10} Hz (dB re harmonic density): ref {np.median(v[:,0]):6.1f}  test {np.median(v[:,1]):6.1f}  diff {np.median(v[:,1]-v[:,0]):+5.1f}")
