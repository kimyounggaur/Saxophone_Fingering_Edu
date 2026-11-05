"""Measure steady-state spectra / attack / noise of reference sax notes.

usage: python3 -I analyze_ref.py <wav_dir> <name_style: flat|sharp> <midi_lo> <midi_hi> <out.json>
Reads <wav_dir>/<Note>.wav (mono float32 44.1 kHz) and writes per-note measurements.
Reference audio is used for measurement only; nothing is redistributed.
"""
import json
import pathlib
import re
import sys

import numpy as np
import scipy.io.wavfile as wf
import scipy.signal as ss

NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def name_to_midi(name):
    if name.isdigit():
        return int(name)
    m = re.fullmatch(r"([A-G])([bs#]?)(-?\d)", name)
    if not m:
        return None
    pc = NOTE_PC[m.group(1)]
    if m.group(2) == "b":
        pc -= 1
    elif m.group(2) in ("s", "#"):
        pc += 1
    return 12 * (int(m.group(3)) + 1) + pc


def load(path):
    sr, x = wf.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return sr, x


def rms_env(x, sr, win=0.01):
    n = int(sr * win)
    k = len(x) // n
    return np.sqrt(np.mean(x[: k * n].reshape(k, n) ** 2, axis=1) + 1e-20), win


def refine_f0(seg, sr, f_nom, n_h=12):
    """Comb-matching f0 search around the nominal pitch (+-70 cents)."""
    n = len(seg)
    w = np.hanning(n)
    nfft = 1 << int(np.ceil(np.log2(n * 4)))
    spec = np.abs(np.fft.rfft(seg * w, nfft))
    freqs = np.arange(len(spec)) * sr / nfft
    best, best_f = -1.0, f_nom
    for cents in np.arange(-70, 70.01, 0.5):
        f = f_nom * 2 ** (cents / 1200)
        s = 0.0
        for k in range(1, n_h + 1):
            fk = f * k
            if fk > sr / 2 - 100:
                break
            i = int(round(fk / (sr / nfft)))
            s += spec[max(0, i - 2): i + 3].max() * (1.0 / np.sqrt(k))
        if s > best:
            best, best_f = s, f
    return best_f


def band_powers(seg, sr, f0, n_h):
    n = len(seg)
    w = np.hanning(n)
    nfft = 1 << int(np.ceil(np.log2(n * 2)))
    spec = np.abs(np.fft.rfft(seg * w, nfft)) ** 2
    df = sr / nfft
    out = []
    half = 0.30 * f0
    for k in range(1, n_h + 1):
        fk = f0 * k
        if fk + half > sr / 2:
            break
        lo, hi = int((fk - half) / df), int((fk + half) / df) + 1
        out.append(spec[lo:hi].sum())
    # valley (between-harmonic) power density
    vals = []
    for k in range(1, n_h):
        fk = f0 * (k + 0.5)
        if fk + 0.15 * f0 > sr / 2:
            break
        lo, hi = int((fk - 0.15 * f0) / df), int((fk + 0.15 * f0) / df) + 1
        vals.append(spec[lo:hi].mean())
    return np.array(out), np.array(vals), spec, df


def analyze(path, midi, sr_expect=44100):
    sr, x = load(path)
    peak = float(np.max(np.abs(x))) or 1.0
    env, hop = rms_env(x, sr)
    db = 20 * np.log10(env / env.max() + 1e-9)
    # first frame above -40 dB re max
    on = int(np.argmax(db > -40))
    # steady region: after reaching 90% of max level, take 0.25 s window
    pk_i = int(np.argmax(env))
    f_nom = 440.0 * 2 ** ((midi - 69) / 12)
    dur = len(x) / sr
    t_on = on * hop
    # attack times (10%->90% of max rms, 1-based on env)
    thr10, thr90 = 0.1 * env.max(), 0.9 * env.max()
    i10 = int(np.argmax(env > thr10))
    i90 = int(np.argmax(env > thr90))
    attack_10_90 = (i90 - i10) * hop
    # choose analysis window: centred 0.55 s after onset, length 0.3 s (clamped)
    win = int(0.30 * sr)
    c = int(min(max(t_on + 0.65, 0.4), max(0.45, dur - 0.35)) * sr)
    a = max(0, c - win // 2)
    seg = x[a: a + win]
    if len(seg) < win // 2 or np.sqrt(np.mean(seg ** 2)) < 1e-5:
        return None
    f0 = refine_f0(seg, sr, f_nom)
    cents = 1200 * np.log2(f0 / f_nom)
    n_h = min(48, int((sr / 2 - 200) / f0))
    bp, valley, spec, df = band_powers(seg, sr, f0, n_h)
    harm_db = 10 * np.log10(bp / bp.max() + 1e-12)
    abs_db_total = 10 * np.log10(bp.sum() + 1e-12)
    # centroid over 0-10k of the full spectrum
    freqs = np.arange(len(spec)) * df
    m = freqs < 10000
    centroid = float((freqs[m] * spec[m]).sum() / spec[m].sum())
    # harmonic-only centroid
    hk = f0 * np.arange(1, len(bp) + 1)
    h_centroid = float((hk * bp).sum() / bp.sum())
    # inharmonic ratio (valley density*bandwidth vs harmonic band power) per region
    regions = {}
    for lo, hi in ((0, 1000), (1000, 3000), (3000, 6000), (6000, 10000)):
        idx = [i for i, f in enumerate(hk) if lo <= f < hi and i < len(bp)]
        vidx = [i for i in range(len(valley)) if lo <= f0 * (i + 1.5) < hi]
        if idx and vidx:
            hp = np.mean(bp[idx]) / (0.60 * f0 / df)  # per-bin density in harmonic band
            vp = np.mean(valley[vidx])
            regions[f"{lo}-{hi}"] = float(10 * np.log10(vp / hp + 1e-12))
    # vibrato / pitch stability: f0 track via autocorr on 40ms frames after onset
    tr = []
    fr = int(0.04 * sr)
    for s in range(int((t_on + 0.15) * sr), min(len(x) - fr, int((t_on + 1.2) * sr)), fr // 2):
        sg = x[s: s + fr] * np.hanning(fr)
        ac = np.correlate(sg, sg, mode="full")[fr - 1:]
        lo = int(sr / (f_nom * 1.06))
        hi = int(sr / (f_nom * 0.94))
        if hi >= len(ac):
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        tr.append(1200 * np.log2((sr / k) / f_nom))
    tr = np.array(tr)
    pitch_sd = float(np.std(tr)) if len(tr) > 3 else None
    # RMS envelope (dB re max) at fixed times after onset for shape reference
    shape = {}
    for tt in (0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.2, 1.6, 2.0):
        j = int((t_on + tt) / hop)
        shape[str(tt)] = float(db[j]) if j < len(db) else None
    # onset curve of harmonic 1..6 over the first 0.2 s (rise time to 50% of its own plateau)
    onset = {}
    for k in range(1, 7):
        fk = f0 * k
        if fk > sr / 2 - 300:
            break
        sos = ss.butter(4, [fk * 0.93, fk * 1.07], btype="band", fs=sr, output="sos")
        y = np.abs(ss.hilbert(ss.sosfiltfilt(sos, x[: int((t_on + 1.0) * sr)])))
        y = ss.savgol_filter(y, 441 if 441 % 2 else 442, 2) if len(y) > 500 else y
        plateau = np.median(y[int((t_on + 0.5) * sr): int((t_on + 0.9) * sr)]) or 1e-9
        j = int(np.argmax(y[int(t_on * sr):] > 0.5 * plateau))
        onset[str(k)] = float(j / sr)
    # robust rise time: 10%->90% of the sustained RMS (median over +0.4..+0.9 s)
    env5, hop5 = rms_env(x, sr, 0.005)
    j0, j1 = int((t_on + 0.4) / hop5), int((t_on + 0.9) / hop5)
    sus = float(np.median(env5[j0:j1])) if j1 > j0 else float(env5.max())
    k10 = int(np.argmax(env5[int(t_on / hop5):] > 0.1 * sus))
    k90 = int(np.argmax(env5[int(t_on / hop5):] > 0.9 * sus))
    rise_10_90 = (k90 - k10) * hop5
    t_to_90 = k90 * hop5
    overshoot_db = float(20 * np.log10(env5[int(t_on / hop5): int((t_on + 0.4) / hop5)].max() / (sus + 1e-12) + 1e-12))
    ctrack = {}
    for tt in (0.01, 0.03, 0.06, 0.1, 0.2, 0.4, 0.8):
        a2 = int((t_on + tt) * sr)
        sg = x[a2: a2 + int(0.03 * sr)]
        if len(sg) < int(0.03 * sr):
            continue
        sp = np.abs(np.fft.rfft(sg * np.hanning(len(sg)), 4096)) ** 2
        fr = np.arange(len(sp)) * sr / 4096
        mm = fr < 10000
        ctrack[str(tt)] = float((fr[mm] * sp[mm]).sum() / (sp[mm].sum() + 1e-20))
    return {
        "rise_10_90_s": float(rise_10_90),
        "t_to_90_s": float(t_to_90),
        "overshoot_db": overshoot_db,
        "centroid_track_hz": ctrack,
        "midi": midi,
        "f0": float(f0),
        "cents_off": float(cents),
        "dur": float(dur),
        "t_on": float(t_on),
        "peak": peak,
        "attack_10_90_s": float(attack_10_90),
        "harm_db": [float(v) for v in harm_db],
        "level_db": float(abs_db_total),
        "centroid_hz": centroid,
        "harm_centroid_hz": h_centroid,
        "inharm_db_by_region": regions,
        "pitch_sd_cents": pitch_sd,
        "env_shape_db": shape,
        "harm_onset_s": onset,
    }


def main():
    wav_dir, style, lo, hi, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    res = {}
    for p in sorted(pathlib.Path(wav_dir).glob("*.wav")):
        midi = name_to_midi(p.stem)
        if midi is None or not (lo <= midi <= hi):
            continue
        r = analyze(str(p), midi)
        if r:
            res[str(midi)] = r
    pathlib.Path(out).write_text(json.dumps(res))
    print(f"{wav_dir}: analysed {len(res)} notes -> {out}")


if __name__ == "__main__":
    main()
