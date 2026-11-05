#!/usr/bin/env python3
"""
Extracts the commissioned alto-saxophone line art into a deterministic module.

The artwork is ONE vector PDF page holding 39 note cells (3 rows x 13 columns).
Every cell repeats the same instrument drawing and differs only in the hand
shapes (plus grey "pressed key" markers and an octave arrow).  This script
separates the cells into

  * body    - the line art shared by all 39 cells (292 stroke paths), drawn once
  * poses   - per written note: shapes drawn BELOW the body (instrument
              silhouette fill) and shapes drawn ABOVE it (hands, key parts)
  * keys    - where the artist's grey markers sit for each key, so the stage can
              highlight keys from the app's own fingering data instead of from
              the artwork's markers
  * markers - which keys the ARTWORK marks per note, so the app can flag notes
              where the artwork and the app's seed fingering disagree

Z-order model: "pose-below -> body -> highlights -> pose-above" reproduces the
original painter's-algorithm result to within 0.01 % of pixels (see --verify).

Usage:
  python3 scripts/extract-illustration-data.py [--source PDF] [--output TS]
                                               [--check] [--verify]

  --check   regenerate in memory and fail if the committed module differs
  --verify  additionally render every cell from the generated data and compare
            it with the source PDF (needs PyMuPDF; uses numpy when present)

Requires PyMuPDF (pip install pymupdf).  The source PDF is NOT part of the
repository: it is a commissioned asset whose licence terms are the owner's call.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import re
import statistics
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - environment guard
    sys.exit("[illustration-data] PyMuPDF is required: pip install pymupdf")

EXTRACTOR_VERSION = "1.0.0"
EXPECTED_SOURCE_SHA256 = "b42cffa443123c3b31176a2b18a528242f7f8bef1ec464afb301962ed7718fd6"
EXPECTED_CELL_COUNT = 39
EXPECTED_INVARIANT_COUNT = 292
WRITTEN_MIDI_MIN = 58
WRITTEN_MIDI_MAX = 90

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = PROJECT_ROOT.parent / "01 Source" / "illustrations" / "saxophone-fingering-line-art.pdf"
DEFAULT_OUTPUT = PROJECT_ROOT / "lib" / "generated" / "illustration-data.ts"
SOURCE_DATA_PATH = PROJECT_ROOT / "lib" / "generated" / "source-data.ts"

# Cell layout (row-major) as lettered by the artist.  Sharps only; the pitches are
# WRITTEN alto pitches.  The layout is corroborated by the data itself: 26 of the
# 33 in-range cells carry exactly the keys the app's seed fingering lists.
CELL_LABELS = [
    ["E5", "F#5", "D#5", "D5", "F5", "C#5", "C5", "B4", "A#4", "A4", "G#4", "G4", "F#4"],
    ["F4", "E4", "C#4", "C4", "D#4", "D4", "B3", "A#3", "A#6", "A6", "C7", "B6", "G#6"],
    ["G6", "E6", "F#6", "D#6", "D6", "F6", "C#6", "A#5", "A5", "C6", "B5", "G#5", "G5"],
]
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Key ids in the app's own order (lib/sax-rig.ts KEY_IDS).
KEY_ORDER = [
    "ok", "pD", "pEb", "pF", "frontF", "lh1", "bis", "lh2", "lh3",
    "gSharp", "lowCSharp", "lowB", "lowBb", "sideE", "sideC", "sideBb",
    "highFSharp", "rh1", "altFSharp", "rh2", "rh3", "lowEb", "lowC",
]

# Where each grey marker cluster sits (reference-frame points).  Only used to NAME
# clusters; an unnamed or doubly-named cluster aborts the run.
MARKER_ANCHORS = {
    "pEb": (82.4, 69.3), "lh1": (74.0, 72.9), "pD": (79.4, 80.8), "pF": (86.7, 81.5),
    "lh2": (75.1, 87.6), "lh3": (76.4, 94.7), "gSharp": (80.3, 103.1),
    "lowB": (84.5, 112.0), "lowBb": (85.1, 121.1), "sideE": (43.9, 163.0),
    "sideC": (46.0, 184.5), "sideBb": (46.4, 197.9), "rh1": (66.6, 198.8),
    "rh2": (67.0, 216.5), "rh3": (65.8, 238.1), "lowEb": (55.3, 245.7),
    "lowC": (53.1, 251.8),
}
# The artwork never marks these two keys.  Their positions are ESTIMATES read off
# the drawing (the C# plate beside the B key; the RH side of the lower stack) and
# are flagged `estimate` so the stage can draw them dashed.
ESTIMATED_KEYS = {
    "lowCSharp": {"x": 81.6, "y": 112.4, "r": 5.2},
    "highFSharp": {"x": 57.8, "y": 208.0, "r": 5.0},
}
ARROW_MIN_WIDTH = 25.0  # the octave-key arrow is the only wide grey shape

# White fills drawn above the body are skin-tinted only when they are hand-sized
# and sit inside a hand zone (reference frame: x0, y0, x1, y1).
HAND_ZONES = [(52.0, 58.0, 112.0, 128.0), (-2.0, 184.0, 84.0, 260.0)]
HAND_MIN_SIZE = 8.0


def fail(message: str) -> "None":
    sys.exit(f"[illustration-data] {message}")


def label_to_midi(label: str) -> int:
    return 12 * (int(label[-1]) + 1) + NOTE_NAMES.index(label[:-1])


# --------------------------------------------------------------------------- load
class Artwork:
    """Cell assignment, cross-cell path matching and frame alignment."""

    def __init__(self, path: Path):
        self.doc = pymupdf.open(path)
        if self.doc.page_count != 1:
            fail(f"expected a single-page PDF, found {self.doc.page_count} pages")
        self.page = self.doc[0]
        self.drawings = self.page.get_drawings()
        self._detect_cells()
        self._match_paths()

    # cells are delimited by the thumbnail images the artist placed in a 3 x 13 grid
    def _detect_cells(self):
        rows = collections.defaultdict(list)
        for info in self.page.get_image_info():
            x0, y0, x1, y1 = info["bbox"]
            rows[round(y0 / 100)].append({"x0": x0, "x1": x1, "y0": y0, "y1": y1})
        keys = sorted(rows)
        for key in keys:
            rows[key].sort(key=lambda cell: cell["x0"])
        if [len(rows[key]) for key in keys] != [13, 13, 13]:
            fail(f"expected 3 rows x 13 cells, found {[len(rows[key]) for key in keys]}")
        self.rows = [rows[key] for key in keys]
        self.row_bands = [(r[0]["y0"], r[0]["y1"]) for r in self.rows]

        self.assign = collections.defaultdict(list)
        for index, drawing in enumerate(self.drawings):
            self.assign[self._cell_of(drawing["rect"])].append(index)
        self.cells = sorted(self.assign)
        if len(self.cells) != EXPECTED_CELL_COUNT:
            fail(f"expected {EXPECTED_CELL_COUNT} cells, found {len(self.cells)}")
        self.label = {cell: CELL_LABELS[cell[0]][cell[1]] for cell in self.cells}
        self.cell_of_label = {label: cell for cell, label in self.label.items()}

    def _cell_of(self, rect):
        cx = (rect.x0 + rect.x1) / 2
        cy = (rect.y0 + rect.y1) / 2
        row = None
        for index, (y0, _y1) in enumerate(self.row_bands):
            nxt = self.row_bands[index + 1][0] if index + 1 < len(self.row_bands) else 1e9
            if y0 - 5 <= cy < nxt - 5:
                row = index
        if row is None:
            fail("a drawing lies outside every cell row")
        cells = self.rows[row]
        col = min(range(len(cells)), key=lambda j: abs((cells[j]["x0"] + cells[j]["x1"]) / 2 - cx))
        return (row, col)

    @staticmethod
    def signature(drawing) -> str:
        """Translation-invariant geometry signature of a drawing."""
        rect = drawing["rect"]
        parts = [drawing["type"], round(drawing.get("width") or 0, 2), str(drawing.get("fill")), len(drawing["items"])]
        for item in drawing["items"][:6]:
            pts = []
            for p in item[1:]:
                if hasattr(p, "x"):
                    pts.append((round(p.x - rect.x0, 1), round(p.y - rect.y0, 1)))
                elif hasattr(p, "x0"):
                    pts.append((round(p.x0 - rect.x0, 1), round(p.y0 - rect.y0, 1), round(p.width, 1), round(p.height, 1)))
            parts.append((item[0], tuple(pts)))
        parts.append((round(rect.width, 1), round(rect.height, 1)))
        return str(parts)

    def _match_paths(self):
        # token = (signature, n-th occurrence inside the cell): identical shapes in
        # different cells get identical tokens, repeated shapes inside a cell differ.
        self.token = {}
        for cell in self.cells:
            seen = collections.Counter()
            for index in self.assign[cell]:
                signature = self.signature(self.drawings[index])
                self.token[index] = (signature, seen[signature])
                seen[signature] += 1
        presence = collections.defaultdict(set)
        for cell in self.cells:
            for index in self.assign[cell]:
                presence[self.token[index]].add(cell)
        self.invariant = {tok for tok, cells in presence.items() if len(cells) == len(self.cells)}
        if len(self.invariant) != EXPECTED_INVARIANT_COUNT:
            fail(f"expected {EXPECTED_INVARIANT_COUNT} invariant paths, found {len(self.invariant)}")

        self.ref = self.cells[0]
        self.invariant_order = [self.token[i] for i in self.assign[self.ref] if self.token[i] in self.invariant]
        self.invariant_index = {tok: i for i, tok in enumerate(self.invariant_order)}
        ref_rect = {self.token[i]: self.drawings[i]["rect"] for i in self.assign[self.ref] if self.token[i] in self.invariant}

        # translation of every cell relative to the reference cell
        self.offset = {}
        for cell in self.cells:
            dxs, dys = [], []
            for index in self.assign[cell]:
                tok = self.token[index]
                if tok in ref_rect:
                    rect = self.drawings[index]["rect"]
                    dxs.append(rect.x0 - ref_rect[tok].x0)
                    dys.append(rect.y0 - ref_rect[tok].y0)
            if statistics.pstdev(dxs) > 0.02 or statistics.pstdev(dys) > 0.02:
                fail(f"cell {self.label[cell]} is not a pure translation of the reference cell")
            self.offset[cell] = (statistics.median(dxs), statistics.median(dys))
            seq = [self.token[i] for i in self.assign[cell] if self.token[i] in self.invariant]
            if seq != self.invariant_order:
                fail(f"cell {self.label[cell]} draws the shared body in a different order")

        # reference frame origin: top-left of everything drawn in the reference cell
        rects = [self.drawings[i]["rect"] for i in self.assign[self.ref]]
        self.origin = (min(r.x0 for r in rects), min(r.y0 for r in rects))

    def items(self, cell):
        """(drawing index, is_invariant, last invariant index drawn before it)."""
        out, last = [], -1
        for index in self.assign[cell]:
            tok = self.token[index]
            if tok in self.invariant:
                last = self.invariant_index[tok]
                out.append((index, True, last))
            else:
                out.append((index, False, last))
        return out

    def shift(self, cell):
        """Translation that moves a drawing of `cell` into the reference frame."""
        dx, dy = self.offset[cell]
        return (-dx - self.origin[0], -dy - self.origin[1])


# --------------------------------------------------------------------------- paths
def num(value: float) -> str:
    text = f"{round(value + 0.0, 1):.1f}"
    if text in ("-0.0", "0.0"):
        return "0"
    return text[:-2] if text.endswith(".0") else text


def path_data(drawing, dx: float = 0.0, dy: float = 0.0) -> str:
    out, cur = [], None
    for item in drawing["items"]:
        op = item[0]
        if op in ("l", "c"):
            p0 = item[1]
            if cur is None or abs(cur[0] - p0.x) > 0.01 or abs(cur[1] - p0.y) > 0.01:
                out.append(f"M{num(p0.x + dx)} {num(p0.y + dy)}")
            if op == "l":
                out.append(f"L{num(item[2].x + dx)} {num(item[2].y + dy)}")
                cur = (item[2].x, item[2].y)
            else:
                out.append("C" + " ".join(f"{num(p.x + dx)} {num(p.y + dy)}" for p in item[2:5]))
                cur = (item[4].x, item[4].y)
        elif op == "re":
            r = item[1]
            out.append(f"M{num(r.x0 + dx)} {num(r.y0 + dy)}h{num(r.width)}v{num(r.height)}h{num(-r.width)}Z")
            cur = None
        elif op == "qu":
            q = item[1]
            out.append("M" + "L".join(f"{num(p.x + dx)} {num(p.y + dy)}" for p in (q.ul, q.ur, q.lr, q.ll)) + "Z")
            cur = None
    if drawing.get("closePath"):
        out.append("Z")
    return "".join(out)


def is_white(drawing) -> bool:
    fill = drawing.get("fill")
    return bool(fill) and fill[0] > 0.99


def is_grey(drawing) -> bool:
    fill = drawing.get("fill")
    return bool(fill) and abs(fill[0] - 0.7) < 0.02


def in_hand_zone(rect, dx: float, dy: float) -> bool:
    cx = (rect.x0 + rect.x1) / 2 + dx
    cy = (rect.y0 + rect.y1) / 2 + dy
    return any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in HAND_ZONES)


def style_of(drawing, layer: str, dx: float, dy: float) -> str:
    """Style key: l = line only, b = base (paper/brass) fill, h = hand fill; width in 1/100 pt;
    trailing r = round caps/joins."""
    width = round((drawing.get("width") or 0) * 100)
    round_ends = bool(drawing.get("lineCap") and drawing["lineCap"][0] == 1) or drawing.get("lineJoin") == 1.0
    suffix = "r" if round_ends else ""
    if drawing.get("fill") is None:
        kind = "l"
    elif is_white(drawing):
        rect = drawing["rect"]
        hand = layer == "top" and max(rect.width, rect.height) >= HAND_MIN_SIZE and in_hand_zone(rect, dx, dy)
        kind = "h" if hand else "b"
    else:
        fail("unexpected fill colour outside the grey markers")
    return f"{kind}{width}{suffix}"


# --------------------------------------------------------------------------- model
def build_model(art: Artwork) -> dict:
    ref = art.ref
    ref_dx, ref_dy = art.shift(ref)

    # ---- shared body: one merged path per stroke width
    body_by_style = collections.OrderedDict()
    for index, invariant, _after in art.items(ref):
        if not invariant:
            continue
        drawing = art.drawings[index]
        if drawing.get("fill") is not None:
            fail("the shared body is expected to be stroke-only")
        style = style_of(drawing, "body", ref_dx, ref_dy)
        body_by_style.setdefault(style, []).append(path_data(drawing, ref_dx, ref_dy))

    style_table: list[str] = []
    path_table: list[str] = []
    style_ids: dict[str, int] = {}
    path_ids: dict[str, int] = {}

    def style_id(style: str) -> int:
        if style not in style_ids:
            style_ids[style] = len(style_table)
            style_table.append(style)
        return style_ids[style]

    def path_id(d: str) -> int:
        if d not in path_ids:
            path_ids[d] = len(path_table)
            path_table.append(d)
        return path_ids[d]

    # ---- markers (grey fills) clustered across cells -> key positions and shapes
    marker_items = []  # (cell, drawing index)
    arrow_items = []
    for cell in art.cells:
        dx, dy = art.shift(cell)
        for index, invariant, _after in art.items(cell):
            drawing = art.drawings[index]
            if invariant or not is_grey(drawing):
                continue
            rect = drawing["rect"]
            record = {
                "cell": cell, "index": index, "cx": (rect.x0 + rect.x1) / 2 + dx, "cy": (rect.y0 + rect.y1) / 2 + dy,
                "w": rect.width, "h": rect.height, "dx": dx, "dy": dy,
            }
            (arrow_items if rect.width > ARROW_MIN_WIDTH else marker_items).append(record)

    clusters = []
    for record in sorted(marker_items, key=lambda r: (r["cy"], r["cx"])):
        for cluster in clusters:
            if abs(cluster["cx"] - record["cx"]) < 1.6 and abs(cluster["cy"] - record["cy"]) < 1.6 and abs(cluster["w"] - record["w"]) < 1.5:
                cluster["members"].append(record)
                n = len(cluster["members"])
                cluster["cx"] = sum(m["cx"] for m in cluster["members"]) / n
                cluster["cy"] = sum(m["cy"] for m in cluster["members"]) / n
                break
        else:
            clusters.append({"cx": record["cx"], "cy": record["cy"], "w": record["w"], "h": record["h"], "members": [record]})

    key_of_cluster = {}
    for index, cluster in enumerate(clusters):
        best = min(MARKER_ANCHORS, key=lambda k: math.hypot(MARKER_ANCHORS[k][0] - cluster["cx"], MARKER_ANCHORS[k][1] - cluster["cy"]))
        if math.hypot(MARKER_ANCHORS[best][0] - cluster["cx"], MARKER_ANCHORS[best][1] - cluster["cy"]) > 2.5:
            fail(f"marker cluster at ({cluster['cx']:.1f}, {cluster['cy']:.1f}) matches no known key")
        if best in key_of_cluster.values():
            fail(f"two marker clusters map to the key {best}")
        key_of_cluster[index] = best
    if set(key_of_cluster.values()) != set(MARKER_ANCHORS):
        fail(f"keys without a marker cluster: {sorted(set(MARKER_ANCHORS) - set(key_of_cluster.values()))}")

    keys = {}
    cell_markers = collections.defaultdict(set)
    for index, cluster in enumerate(clusters):
        key = key_of_cluster[index]
        first = min(cluster["members"], key=lambda m: m["cell"])
        shape = path_data(art.drawings[first["index"]], first["dx"], first["dy"])
        keys[key] = {
            "x": float(num(cluster["cx"])), "y": float(num(cluster["cy"])),
            "r": float(num(max(cluster["w"], cluster["h"]) / 2 + 1.8)),
            "source": "marker", "shape": shape,
        }
        for member in cluster["members"]:
            cell_markers[member["cell"]].add(key)

    # octave arrow: use the reference cell's own arrow as the single canonical one
    ref_arrows = [a for a in arrow_items if a["cell"] == ref]
    if len(ref_arrows) != 1:
        fail("the reference cell should carry exactly one octave arrow")
    arrow = ref_arrows[0]
    # the ring sits just beyond the arrow head, on the instrument edge the arrow points at
    keys["ok"] = {
        "x": float(num(arrow["cx"] + arrow["w"] / 2 + 3.2)), "y": float(num(arrow["cy"])),
        "r": 5.5, "source": "arrow",
        "shape": path_data(art.drawings[arrow["index"]], arrow["dx"], arrow["dy"]),
    }
    for item in arrow_items:
        cell_markers[item["cell"]].add("ok")
    for key, spec in ESTIMATED_KEYS.items():
        keys[key] = {**spec, "source": "estimate"}

    # ---- per-note poses
    poses, markers, altissimo = {}, {}, []
    stats = {"items": 0}
    min_x = min_y = math.inf
    max_x = max_y = -math.inf

    def grow(d: str):
        nonlocal min_x, min_y, max_x, max_y
        nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", d)]
        # coordinates are absolute pairs apart from the rectangle h/v shorthand, which
        # only occurs inside short closed boxes; pair-wise growth is a safe superset.
        for x, y in zip(nums[0::2], nums[1::2]):
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)

    for cell in art.cells:
        midi = label_to_midi(art.label[cell])
        if not (WRITTEN_MIDI_MIN <= midi <= WRITTEN_MIDI_MAX):
            altissimo.append(art.label[cell])
            continue
        dx, dy = art.shift(cell)
        bottom, top = [], []
        for index, invariant, after in art.items(cell):
            drawing = art.drawings[index]
            if invariant or is_grey(drawing):
                continue
            layer = "bottom" if after < 0 else "top"
            d = path_data(drawing, dx, dy)
            grow(d)
            item = [style_id(style_of(drawing, layer, dx, dy)), path_id(d)]
            (bottom if layer == "bottom" else top).append(item)
            stats["items"] += 1
        poses[midi] = {"bottom": bottom, "top": top}
        markers[midi] = sorted(cell_markers[cell], key=KEY_ORDER.index)
    for style, parts in body_by_style.items():
        for part in parts:
            grow(part)
    body = [[style_id(style), "".join(parts)] for style, parts in body_by_style.items()]

    if sorted(poses) != list(range(WRITTEN_MIDI_MIN, WRITTEN_MIDI_MAX + 1)):
        fail("poses do not cover the app's written MIDI range")

    return {
        "schemaVersion": 1,
        "extractorVersion": EXTRACTOR_VERSION,
        "source": {
            "sha256": EXPECTED_SOURCE_SHA256,
            "cells": len(art.cells),
            "sourceUnits": "pt",
            "frame": "E5 reference cell, origin = top-left of its drawings",
            "excludedAltissimoCells": sorted(altissimo, key=label_to_midi),
        },
        "bounds": [math.floor(min_x), math.floor(min_y), math.ceil(max_x), math.ceil(max_y)],
        "styles": style_table,
        "paths": path_table,
        "body": body,
        "keys": {k: keys[k] for k in KEY_ORDER if k in keys},
        "poses": {m: poses[m] for m in sorted(poses)},
        "markers": {m: markers[m] for m in sorted(markers)},
    }


# --------------------------------------------------------------------------- output
HEADER = """/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 * Source: ../01 Source/illustrations/saxophone-fingering-line-art.pdf (commissioned line art)
 * Source SHA-256: {sha}
 * Extractor version: {version}
 *
 * Regenerate with: python3 scripts/extract-illustration-data.py
 * The source PDF is intentionally not part of this repository.
 */

"""

TYPES = """/** [style index, path index] — drawn in array order. */
export type IllustrationItem = readonly [number, number];

export interface IllustrationKeyShape {
  /** Centre of the artist's marker (reference frame, pt). */
  readonly x: number;
  readonly y: number;
  /** Highlight ring radius. */
  readonly r: number;
  /** `marker`/`arrow` = taken from the artwork; `estimate` = read off the drawing by hand. */
  readonly source: "marker" | "arrow" | "estimate";
  /** The artist's own marker outline, restyled by the stage. Absent for estimates. */
  readonly shape?: string;
}

export interface IllustrationPose {
  /** Drawn under the shared body: instrument silhouette fills. */
  readonly bottom: readonly IllustrationItem[];
  /** Drawn over the shared body: hands and moving key parts. */
  readonly top: readonly IllustrationItem[];
}

export interface IllustrationData {
  readonly schemaVersion: 1;
  readonly extractorVersion: string;
  readonly source: {
    readonly sha256: string;
    readonly cells: number;
    readonly sourceUnits: string;
    readonly frame: string;
    readonly excludedAltissimoCells: readonly string[];
  };
  /** Union bounds of everything drawn: [minX, minY, maxX, maxY]. */
  readonly bounds: readonly [number, number, number, number];
  /** Style keys: l = line, b = base fill, h = hand fill; digits = stroke width in 1/100 pt; r = round ends. */
  readonly styles: readonly string[];
  readonly paths: readonly string[];
  /** Shared body line art, merged per style: [style index, path data]. */
  readonly body: readonly (readonly [number, string])[];
  readonly keys: Readonly<Record<string, IllustrationKeyShape>>;
  /** Keyed by written MIDI. */
  readonly poses: Readonly<Record<number, IllustrationPose>>;
  /** Keys the ARTWORK marks for each written MIDI (not the app's seed data). */
  readonly markers: Readonly<Record<number, readonly string[]>>;
}

"""


def render_module(model: dict) -> str:
    lines = [HEADER.format(sha=EXPECTED_SOURCE_SHA256, version=EXTRACTOR_VERSION), TYPES, "export const ILLUSTRATION_DATA: IllustrationData = {"]

    def field(name: str, value, last: bool = False):
        lines.append(f"  {name}: {json.dumps(value, ensure_ascii=False, separators=(',', ':'))}" + ("" if last else ","))

    field("schemaVersion", model["schemaVersion"])
    field("extractorVersion", model["extractorVersion"])
    field("source", model["source"])
    field("bounds", model["bounds"])
    field("styles", model["styles"])
    lines.append("  paths: [")
    lines.extend(f"    {json.dumps(p)}," for p in model["paths"])
    lines.append("  ],")
    lines.append("  body: [")
    lines.extend(f"    [{style}, {json.dumps(d)}]," for style, d in model["body"])
    lines.append("  ],")
    lines.append("  keys: {")
    for key, spec in model["keys"].items():
        lines.append(f"    {key}: {json.dumps(spec, ensure_ascii=False, separators=(',', ':'))},")
    lines.append("  },")
    lines.append("  poses: {")
    for midi, pose in model["poses"].items():
        lines.append(f"    {midi}: {json.dumps(pose, separators=(',', ':'))},")
    lines.append("  },")
    lines.append("  markers: {")
    for midi, keys in model["markers"].items():
        lines.append(f"    {midi}: {json.dumps(keys, separators=(',', ':'))},")
    lines.append("  },")
    lines.append("};")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- verify
def _pixels(pixmap):
    return bytes(pixmap.samples)[:: pixmap.n]  # first channel only (greyscale line art)


def verify(art: Artwork, model: dict, scale: int = 3) -> bool:
    """Render each cell from the GENERATED data and compare with the source page.

    The comparison ignores the artist's grey markers/arrow (they are re-drawn by the
    stage from key data) by masking the pixels inside their bounding boxes.
    """
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        np = None

    def render(svg: str):
        pix = pymupdf.open(stream=svg.encode(), filetype="svg")[0].get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, 0].astype(np.int16) if np else (pix.width, pix.height, _pixels(pix))

    def element(d: str, style: str) -> str:
        kind, width = style[0], int(re.match(r"[lbh](\d+)", style).group(1)) / 100
        fill = "none" if kind == "l" else "#fff"
        join = "round" if style.endswith("r") else "miter"
        cap = "round" if style.endswith("r") else "butt"
        return f'<path d="{d}" fill="{fill}" stroke="#000" stroke-width="{width}" stroke-linecap="{cap}" stroke-linejoin="{join}" stroke-miterlimit="10"/>'

    styles, paths = model["styles"], model["paths"]
    body = "".join(element(d, styles[s]) for s, d in model["body"])
    ox, oy = art.origin
    worst = 0.0
    total_bad = 0
    for cell in art.cells:
        midi = label_to_midi(art.label[cell])
        if midi not in model["poses"]:
            continue
        pose = model["poses"][midi]
        rects = [art.drawings[i]["rect"] for i in art.assign[cell]]
        x0 = math.floor((min(r.x0 for r in rects) - 3) * scale) / scale
        y0 = math.floor((min(r.y0 for r in rects) - 3) * scale) / scale
        x1 = math.ceil((max(r.x1 for r in rects) + 3) * scale) / scale
        y1 = math.ceil((max(r.y1 for r in rects) + 3) * scale) / scale
        w, h = x1 - x0, y1 - y0
        cdx, cdy = art.offset[cell]
        # generated data lives in the reference frame: move the viewport there
        vx, vy = x0 - cdx - ox, y0 - cdy - oy
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{vx} {vy} {w} {h}">'
               f'<rect x="{vx}" y="{vy}" width="{w}" height="{h}" fill="#fff"/>'
               + "".join(element(paths[p], styles[s]) for s, p in pose["bottom"]) + body
               + "".join(element(paths[p], styles[s]) for s, p in pose["top"]) + "</svg>")
        clip = pymupdf.Rect(x0, y0, x1, y1)
        original = art.page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
        if np is None:
            fail("--verify needs numpy for the pixel comparison")
        a = np.frombuffer(original.samples, dtype=np.uint8).reshape(original.height, original.width, original.n)[:, :, 0].astype(np.int16)
        b = render(svg)
        height, width = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        diff = np.abs(a[:height, :width] - b[:height, :width]) > 96
        for index in art.assign[cell]:
            drawing = art.drawings[index]
            if is_grey(drawing):
                r = drawing["rect"]
                gx0, gy0 = int((r.x0 - 1.5 - x0) * scale), int((r.y0 - 1.5 - y0) * scale)
                gx1, gy1 = int((r.x1 + 1.5 - x0) * scale) + 1, int((r.y1 + 1.5 - y0) * scale) + 1
                diff[max(gy0, 0):max(gy1, 0), max(gx0, 0):max(gx1, 0)] = False
        bad = int(diff.sum())
        total_bad += bad
        worst = max(worst, bad / diff.size)
    print(f"[illustration-data] verify: {total_bad} differing pixels over {len(model['poses'])} cells, worst cell {worst:.4%}")
    return worst < 0.0005


# --------------------------------------------------------------------------- report
def seed_report(model: dict):
    """Compare the artwork's markers with the app's seed fingering (informational)."""
    if not SOURCE_DATA_PATH.exists():
        return
    text = SOURCE_DATA_PATH.read_text(encoding="utf-8")
    match = re.search(r'"notes": \[(.*)\n  \]', text, re.S)
    if not match:
        return
    notes = json.loads("[" + match.group(1) + "]")
    rows = []
    for note in notes:
        seed = set(note["pressed"])
        art = set(model["markers"].get(note["midi"], []))
        if seed != art:
            rows.append((note["midi"], note["label"], sorted(seed - art), sorted(art - seed)))
    print(f"[illustration-data] artwork vs seed: {len(notes) - len(rows)} of {len(notes)} notes agree; {len(rows)} differ")
    for midi, label, only_seed, only_art in rows:
        print(f"    {midi} {label}: seed-only {only_seed or '-'} | artwork-only {only_art or '-'}")


# --------------------------------------------------------------------------- main
def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="fail when the committed module is out of date")
    parser.add_argument("--verify", action="store_true", help="render the generated data and compare it with the source PDF")
    args = parser.parse_args(argv)

    if not args.source.exists():
        fail(f"source PDF not found: {args.source} (pass --source)")
    digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if digest != EXPECTED_SOURCE_SHA256:
        fail(f"source SHA-256 mismatch: expected {EXPECTED_SOURCE_SHA256}, got {digest}")

    art = Artwork(args.source)
    model = build_model(art)
    module = render_module(model)

    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != module:
            fail(f"{args.output} is out of date; run python3 scripts/extract-illustration-data.py")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(module, encoding="utf-8")

    unique_paths = len(model["paths"])
    refs = sum(len(p["bottom"]) + len(p["top"]) for p in model["poses"].values())
    print(f"[illustration-data] {'verified' if args.check else 'wrote'} {args.output.name}: "
          f"{len(model['poses'])} notes, {len(model['keys'])} keys, {unique_paths} unique paths for {refs} pose items, "
          f"{len(module.encode('utf-8')) / 1024:.0f} KiB")
    seed_report(model)
    if args.verify and not verify(art, model):
        fail("generated data deviates from the source rendering")
    return 0


if __name__ == "__main__":
    sys.exit(main())
