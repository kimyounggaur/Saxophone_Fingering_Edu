"""Micro-variation statistics of sustained sax tones (AM / FM / noise skirts).

usage: python3 -I analyze_micro.py <wav_dir> <midi_lo> <midi_hi> <out.json> [t0=0.35] [t1=1.35]
Complex-demodulates each harmonic k*f0 over [t_on+t0, t_on+t1] and reports:
  am_pct[k]    : std(A)/mean(A) of the amplitude envelope (>0.7 Hz)
  fm_cents[k]  : std of the instantaneous-frequency deviation in cents (>0.7 Hz)
  skirt_db[k]  : noise-skirt power (2..40 Hz offset) relative to carrier power (<2 Hz), dB
  vib_hz/vib_cents : dominant 3.5..8 Hz modulation in f0 (vibrato) and its depth (peak, cents)
"""
import json
import pathlib
import sys

import numpy as np
import scipy.io.wavfile as wf
import scipy.signal as ss

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from analyze_ref import name_to_midi, rms_env, refine_f0  # noqa: E402


def demod(x, sr, fk, t, bw=45.0):
    z = x * np.exp(-2j * np.pi * fk * t)
    sos = ss.butter(4, bw, btype="low", fs=sr, output="sos")
    return ss.sosfiltfilt(sos, z.real) + 1j * ss.sosfiltfilt(sos, z.imag)


def analyze(path, midi, t0, t1):
    sr, x = wf.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    env, hop = rms_env(x, sr)
    db = 20 * np.log10(env / env.max() + 1e-9)
    t_on = int(np.argmax(db > -40)) * hop
    a, b = int((t_on + t0 - 0.15) * sr), int((t_on + t1 + 0.15) * sr)
    if b > len(x):
        return None
    seg = x[a:b]
    f_nom = 440.0 * 2 ** ((midi - 69) / 12)
    f0 = refine_f0(seg[int(0.15 * sr): int(0.15 * sr) + int(0.3 * sr)], sr, f_nom)
    t = np.arange(len(seg)) / sr
    keep = slice(int(0.15 * sr), len(seg) - int(0.15 * sr))
    out = {"f0": float(f0), "am_pct": {}, "fm_cents": {}, "skirt_db": {}}
    f0_tracks = []
    for k in range(1, 9):
        fk = f0 * k
        if fk > sr / 2 - 600:
            break
        z = demod(seg, sr, fk, t)[keep]
        amp = np.abs(z)
        if amp.mean() < 1e-6:
            continue
        # amplitude modulation (remove <0.7 Hz trend by high-pass)
        sos_hp = ss.butter(2, 0.7, btype="high", fs=sr, output="sos")
        am = ss.sosfiltfilt(sos_hp, amp / amp.mean())
        out["am_pct"][str(k)] = float(100 * np.std(am))
        ph = np.unwrap(np.angle(z))
        inst = np.gradient(ph) * sr / (2 * np.pi)  # Hz offset from fk
        cents = 1200 * np.log2((fk + inst) / fk)
        cents_hp = ss.sosfiltfilt(sos_hp, cents)
        out["fm_cents"][str(k)] = float(np.std(cents_hp))
        if k <= 3:
            f0_tracks.append(cents)
        # skirt power
        zz = z - z.mean()
        nfft = 1 << int(np.ceil(np.log2(len(z))))
        P = np.abs(np.fft.fft(z * np.hanning(len(z)), nfft)) ** 2
        fr = np.fft.fftfreq(nfft, 1 / sr)
        # centre the carrier on its own spectral peak (robust to small f0 estimation errors)
        near = np.abs(fr) <= 8.0
        pk = fr[near][int(np.argmax(P[near]))]
        off = np.abs(fr - pk)
        carrier = P[off < 1.5].sum()
        skirt = P[(off >= 2.0) & (off <= 40.0)].sum()
        out["skirt_db"][str(k)] = float(10 * np.log10(skirt / (carrier + 1e-20) + 1e-20))
    if f0_tracks:
        trk = np.mean(f0_tracks, axis=0)
        trk = trk - trk.mean()
        n = len(trk)
        sp = np.abs(np.fft.rfft(trk * np.hanning(n), 1 << 15))
        fr = np.fft.rfftfreq(1 << 15, 1 / sr)
        # decimate-free: the track is at sr; restrict to 3.5..8 Hz
        m = (fr >= 3.5) & (fr <= 8.0)
        j = int(np.argmax(sp[m]))
        out["vib_hz"] = float(fr[m][j])
        # peak amplitude in cents of that line (normalise by window sum)
        out["vib_cents"] = float(2 * sp[m][j] / np.sum(np.hanning(n)))
        out["f0_dev_cents_std"] = float(np.std(trk))
    return out


def main():
    wav_dir, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    t0 = float(sys.argv[5]) if len(sys.argv) > 5 else 0.35
    t1 = float(sys.argv[6]) if len(sys.argv) > 6 else 1.35
    res = {}
    for p in sorted(pathlib.Path(wav_dir).glob("*.wav")):
        midi = name_to_midi(p.stem)
        if midi is None or not (lo <= midi <= hi):
            continue
        r = analyze(str(p), midi, t0, t1)
        if r:
            res[str(midi)] = r
    pathlib.Path(out).write_text(json.dumps(res))
    # summary
    def med(key, k):
        v = [r[key][str(k)] for r in res.values() if str(k) in r[key]]
        return float(np.median(v)) if v else float("nan")
    print(f"{wav_dir}: {len(res)} notes")
    for key, unit in (("am_pct", "%"), ("fm_cents", "cents"), ("skirt_db", "dB")):
        print(f"  {key:9s} " + " ".join(f"k{k}={med(key, k):7.2f}" for k in (1, 2, 3, 4, 6, 8)) + f"  [{unit}]")
    vc = [r["vib_cents"] for r in res.values() if "vib_cents" in r]
    fd = [r["f0_dev_cents_std"] for r in res.values() if "f0_dev_cents_std" in r]
    print(f"  vibrato-band line (3.5-8 Hz) median {np.median(vc):.2f} cents peak; f0 deviation std median {np.median(fd):.2f} cents")


if __name__ == "__main__":
    main()
