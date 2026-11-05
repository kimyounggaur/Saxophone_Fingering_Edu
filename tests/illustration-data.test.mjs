import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const { ILLUSTRATION_DATA: art } = await import("../lib/generated/illustration-data.ts");
const { SOURCE_DATA: seed } = await import("../lib/generated/source-data.ts");

const WRITTEN_MIDI = Array.from({ length: 33 }, (_, index) => 58 + index);

/**
 * The seed fingering and the artist's markers must agree, or the stage shows a review
 * warning.  This list is the set of notes where they currently do NOT agree.  Do not edit
 * it to make this test pass: a human reviewer decides which side is right (the seed in
 * lib/generated/source-data.ts or the artwork), and docs/data-review.md records the decision.
 */
const KNOWN_MISMATCHES = {
  60: { seedOnly: ["rh1"], artworkOnly: [] },
  61: { seedOnly: ["lowC", "lowCSharp"], artworkOnly: ["lowEb"] },
  63: { seedOnly: ["rh1"], artworkOnly: [] },
  70: { seedOnly: [], artworkOnly: ["lh2"] },
  82: { seedOnly: [], artworkOnly: ["lh2"] },
  88: { seedOnly: ["pD", "pEb"], artworkOnly: [] },
  90: { seedOnly: ["highFSharp", "pD", "pEb", "pF", "sideE"], artworkOnly: ["lh1", "lh3", "sideBb"] },
};

/** Same comparison as `illustrationMismatch` in lib/illustration.ts, written independently. */
function compare(midi) {
  const note = seed.notes.find((entry) => entry.midi === midi);
  const seedKeys = new Set(note.pressed);
  const artKeys = new Set(art.markers[midi] ?? []);
  return {
    seedOnly: [...seedKeys].filter((key) => !artKeys.has(key)).sort(),
    artworkOnly: [...artKeys].filter((key) => !seedKeys.has(key)).sort(),
  };
}

// lib/illustration.ts imports "./generated/illustration-data" without an extension, which
// Node cannot resolve on its own.  Transpile it here and point the import at the real file so
// the helpers the stage uses are tested as written, not re-implemented.
async function loadIllustrationHelpers() {
  const source = await readFile(new URL("../lib/illustration.ts", import.meta.url), "utf8");
  const dataUrl = new URL("../lib/generated/illustration-data.ts", import.meta.url).href;
  const specifier = '"./generated/illustration-data"';
  assert.ok(source.includes(specifier), "lib/illustration.ts no longer imports the generated data as expected");
  const { outputText } = ts.transpileModule(source.replace(specifier, JSON.stringify(dataUrl)), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const helpers = await loadIllustrationHelpers();

// ------------------------------------------------------------------ generated data
test("illustration data is stamped with the pinned source and extractor", async () => {
  const [moduleText, scriptText] = await Promise.all([
    readFile(new URL("lib/generated/illustration-data.ts", root), "utf8"),
    readFile(new URL("scripts/extract-illustration-data.py", root), "utf8"),
  ]);
  assert.match(moduleText, /AUTO-GENERATED FILE — DO NOT EDIT/);
  const headerSha = moduleText.match(/Source SHA-256: ([0-9a-f]{64})/)?.[1];
  const headerVersion = moduleText.match(/Extractor version: (\S+)/)?.[1];
  const pinnedSha = scriptText.match(/EXPECTED_SOURCE_SHA256 = "([0-9a-f]{64})"/)?.[1];
  const scriptVersion = scriptText.match(/EXTRACTOR_VERSION = "([^"]+)"/)?.[1];
  assert.ok(headerSha && pinnedSha && headerVersion && scriptVersion, "header or script constants are missing");
  assert.equal(headerSha, pinnedSha);
  assert.equal(art.source.sha256, pinnedSha);
  assert.equal(headerVersion, scriptVersion);
  assert.equal(art.extractorVersion, scriptVersion);
  assert.equal(art.schemaVersion, 1);
});

test("illustration data stays within its payload budget", async () => {
  const { size } = await stat(new URL("lib/generated/illustration-data.ts", root));
  assert.ok(size < 220 * 1024, `illustration-data.ts is ${(size / 1024).toFixed(0)} KiB; the client bundle budget is 220 KiB`);
});

test("has one pose for every written note and nothing above F♯6", () => {
  assert.deepEqual(Object.keys(art.poses).map(Number), WRITTEN_MIDI);
  assert.deepEqual(art.source.excludedAltissimoCells, ["G6", "G#6", "A6", "A#6", "B6", "C7"]);
  assert.equal(art.source.cells, 39);
  assert.deepEqual(art.bounds, [0, 0, 134, 321]);
});

test("every drawn item points at a real style and path, and no path is stored twice", () => {
  assert.equal(new Set(art.paths).size, art.paths.length, "duplicate path strings");
  for (const style of art.styles) assert.match(style, /^[lbh]\d+r?$/);
  const pathData = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/;
  for (const d of art.paths) assert.match(d, pathData);

  const usedPaths = new Set();
  const check = ([style, path], where) => {
    assert.ok(Number.isInteger(style) && style >= 0 && style < art.styles.length, `${where}: bad style ${style}`);
    assert.ok(Number.isInteger(path) && path >= 0 && path < art.paths.length, `${where}: bad path ${path}`);
    usedPaths.add(path);
  };
  for (const midi of WRITTEN_MIDI) {
    const pose = art.poses[midi];
    assert.ok(pose.bottom.length + pose.top.length > 0, `pose ${midi} is empty`);
    for (const item of pose.bottom) check(item, `pose ${midi} bottom`);
    for (const item of pose.top) check(item, `pose ${midi} top`);
  }
  assert.equal(usedPaths.size, art.paths.length, "some stored paths are never drawn");

  assert.ok(art.body.length > 0);
  for (const [style, d] of art.body) {
    assert.ok(Number.isInteger(style) && style >= 0 && style < art.styles.length);
    assert.match(d, pathData);
  }
});

test("every key the seed fingering presses has a position on the artwork", () => {
  const seedKeyIds = new Set(seed.keys.map((key) => key.id));
  const pressed = new Set(seed.notes.flatMap((note) => note.pressed));
  for (const id of pressed) assert.ok(art.keys[id], `seed presses ${id} but the artwork has no position for it`);
  for (const id of Object.keys(art.keys)) assert.ok(seedKeyIds.has(id), `artwork key ${id} is not a seed key`);

  const [, , maxX, maxY] = art.bounds;
  for (const [id, key] of Object.entries(art.keys)) {
    assert.ok(Number.isFinite(key.x) && key.x > 0 && key.x < maxX, `${id}.x`);
    assert.ok(Number.isFinite(key.y) && key.y > 0 && key.y < maxY, `${id}.y`);
    assert.ok(Number.isFinite(key.r) && key.r > 2 && key.r < 12, `${id}.r`);
    assert.ok(["marker", "arrow", "estimate"].includes(key.source), `${id}.source`);
    assert.equal(typeof key.shape, key.source === "estimate" ? "undefined" : "string", `${id}.shape`);
  }
  // These two keys carry no marker in any of the 33 drawings, so their positions are estimates.
  assert.deepEqual(
    Object.entries(art.keys).filter(([, key]) => key.source === "estimate").map(([id]) => id).sort(),
    ["highFSharp", "lowCSharp"],
  );
  assert.equal(art.keys.ok.source, "arrow");
});

test("artwork and seed fingering disagree on exactly the documented notes", async () => {
  const actual = {};
  for (const midi of WRITTEN_MIDI) {
    const diff = compare(midi);
    if (diff.seedOnly.length || diff.artworkOnly.length) actual[midi] = diff;
  }
  assert.deepEqual(
    actual,
    KNOWN_MISMATCHES,
    "The artwork/seed disagreement list changed. A human reviewer must decide which side is right; then update docs/data-review.md and KNOWN_MISMATCHES.",
  );

  // The stage's own comparison must agree with the independent one above.
  for (const midi of WRITTEN_MIDI) {
    const note = seed.notes.find((entry) => entry.midi === midi);
    assert.deepEqual(helpers.illustrationMismatch(midi, note.pressed), KNOWN_MISMATCHES[midi] ?? null, `note ${midi}`);
  }

  // Every mismatch must be listed in the human review ledger.
  const ledger = await readFile(new URL("docs/data-review.md", root), "utf8");
  const section = ledger.slice(ledger.indexOf("일러스트 ↔ seed 불일치"));
  assert.ok(section.length > 0 && ledger.includes("일러스트 ↔ seed 불일치"), "docs/data-review.md has no illustration mismatch section");
  for (const midi of Object.keys(KNOWN_MISMATCHES)) {
    assert.match(section, new RegExp(`^\\| ${midi} \\|`, "m"), `note ${midi} is missing from the review ledger`);
  }
});

const sourcePdf = new URL("../01 Source/illustrations/saxophone-fingering-line-art.pdf", root);
const pythonHasPyMuPdf = existsSync(sourcePdf) && spawnSync("python3", ["-c", "import pymupdf"]).status === 0;
test(
  "regenerating from the commissioned PDF reproduces the committed module",
  { skip: !existsSync(sourcePdf) ? "source PDF is not part of the repository" : !pythonHasPyMuPdf ? "PyMuPDF is not installed" : false },
  () => {
    const checked = spawnSync("python3", ["scripts/extract-illustration-data.py", "--check"], { cwd: root, encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.match(checked.stdout, /33 notes, 20 keys/);
  },
);

// ------------------------------------------------------------ lib/illustration.ts
test("only notes the artwork can fully draw use the illustrated stage", () => {
  const { canIllustrate, writtenMidiFromNoteId } = helpers;
  assert.equal(writtenMidiFromNoteId("written-76"), 76);
  assert.equal(writtenMidiFromNoteId("concert-76"), null);
  assert.equal(writtenMidiFromNoteId(undefined), null);

  for (const note of seed.notes) assert.equal(canIllustrate(note.midi, note.pressed), true, `seed note ${note.midi}`);
  assert.equal(canIllustrate(null, []), false);
  assert.equal(canIllustrate(120, ["lh1"]), false, "a note without a pose");
  assert.equal(canIllustrate(76, ["lh1", "frontF"]), false, "a key without a position");
});

test("mirroring is an exact reflection of the frame and every zoom stays inside it", () => {
  const { ILLUSTRATION_FRAME, ILLUSTRATION_VIEWS, illustrationViewBox, mirrorX } = helpers;
  assert.equal(mirrorX(mirrorX(12.5)), 12.5);
  assert.deepEqual(illustrationViewBox("full", true), ILLUSTRATION_FRAME);
  assert.deepEqual(illustrationViewBox("full", false), ILLUSTRATION_FRAME);

  const frameRight = ILLUSTRATION_FRAME.x + ILLUSTRATION_FRAME.w;
  for (const [zoom, box] of Object.entries(ILLUSTRATION_VIEWS)) {
    assert.ok(box.x >= ILLUSTRATION_FRAME.x && box.x + box.w <= frameRight, `${zoom} leaves the frame horizontally`);
    assert.ok(box.y >= 0 && box.y + box.h <= ILLUSTRATION_FRAME.h, `${zoom} leaves the frame vertically`);
    const flipped = illustrationViewBox(zoom, true);
    assert.equal(flipped.w, box.w);
    assert.equal(flipped.h, box.h);
    assert.equal(flipped.x, mirrorX(box.x + box.w));
    assert.ok(flipped.x >= ILLUSTRATION_FRAME.x && flipped.x + flipped.w <= frameRight, `${zoom} (mirrored) leaves the frame`);
  }
});

test("key-name chips never overlap, stay inside the frame, and skip the octave key", () => {
  const { ILLUSTRATION_FRAME, ILLUSTRATION_VIEWS, layoutKeyChips } = helpers;
  const frameRight = ILLUSTRATION_FRAME.x + ILLUSTRATION_FRAME.w;
  for (const viewHeight of [ILLUSTRATION_VIEWS.hands.h, ILLUSTRATION_VIEWS.right.h, ILLUSTRATION_VIEWS.left.h]) {
    for (const note of seed.notes) {
      const chips = layoutKeyChips(note.pressed, viewHeight);
      const expected = note.pressed.filter((key) => key !== "ok");
      assert.deepEqual(chips.map((chip) => chip.keyId).sort(), [...expected].sort(), `note ${note.midi}: chip per pressed key`);

      for (const chip of chips) {
        assert.ok(chip.x - chip.width / 2 >= ILLUSTRATION_FRAME.x - 0.01, `note ${note.midi} ${chip.keyId}: chip leaves the frame on the left`);
        assert.ok(chip.x + chip.width / 2 <= frameRight + 0.01, `note ${note.midi} ${chip.keyId}: chip leaves the frame on the right`);
        assert.ok(chip.y + chip.height / 2 <= ILLUSTRATION_FRAME.h, `note ${note.midi} ${chip.keyId}: chip leaves the frame at the bottom`);
      }
      for (let a = 0; a < chips.length; a += 1) {
        for (let b = a + 1; b < chips.length; b += 1) {
          if (chips[a].edgeX !== chips[b].edgeX) continue; // different margins cannot collide
          const gap = Math.abs(chips[a].y - chips[b].y);
          assert.ok(gap >= chips[a].height - 0.01, `note ${note.midi}: ${chips[a].keyId} and ${chips[b].keyId} overlap`);
        }
      }
    }
  }
  assert.deepEqual(layoutKeyChips(["ok"], 222), []);
});

test("octave arrow label sits on the artist's arrow and every style has a CSS class", () => {
  const { OCTAVE_ARROW_LABEL, STYLE_CLASSES } = helpers;
  const numbers = (art.keys.ok.shape.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  assert.ok(OCTAVE_ARROW_LABEL.x > Math.min(...xs) && OCTAVE_ARROW_LABEL.x < Math.max(...xs));
  assert.ok(OCTAVE_ARROW_LABEL.y > Math.min(...ys) && OCTAVE_ARROW_LABEL.y < Math.max(...ys));

  assert.equal(STYLE_CLASSES.length, art.styles.length);
  assert.equal(STYLE_CLASSES[art.styles.indexOf("l15")], "sx-l sx-w15");
  assert.equal(STYLE_CLASSES[art.styles.indexOf("h60r")], "sx-h sx-w60 sx-r");
});
