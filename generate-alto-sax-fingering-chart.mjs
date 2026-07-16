import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const bundledNodeModules =
  process.env.CODEX_NODE_MODULES ||
  "C:/Users/kimyo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";

function findPlaywrightPackageJson() {
  const local = resolve(process.cwd(), "node_modules", "playwright", "package.json");
  if (existsSync(local)) return local;
  const direct = join(bundledNodeModules, "playwright", "package.json");
  const pnpmRoot = join(bundledNodeModules, ".pnpm");
  if (existsSync(pnpmRoot)) {
    const entry = readdirSync(pnpmRoot, { withFileTypes: true }).find(
      (dirent) => dirent.isDirectory() && /^playwright@/.test(dirent.name),
    );
    if (entry) {
      const packageJson = join(pnpmRoot, entry.name, "node_modules", "playwright", "package.json");
      if (existsSync(packageJson)) return packageJson;
    }
  }
  return direct;
}

function loadChromium() {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire("playwright").chromium;
  } catch {
    const packageJson = findPlaywrightPackageJson();
    if (!existsSync(packageJson)) {
      throw new Error("Playwright를 찾지 못했습니다. 이 폴더에서 npm install playwright를 실행해 주세요.");
    }
    return createRequire(packageJson)("playwright").chromium;
  }
}

const cliArgs = process.argv.slice(2);
const requestedChartKind = cliArgs.find((arg) => !arg.startsWith("--")) || "alto";
const skipPdf = cliArgs.includes("--no-pdf");
const chartConfigs = {
  alto: {
    prefix: "alto",
    englishName: "Alto Saxophone",
    koreanName: "알토 색소폰",
    instrumentTag: "Eb alto sax",
    sheetMark: "Alto sax · written pitch",
    transpositionSemitones: 9,
    transpositionText: "알토는 Eb 조 이조악기이므로 실제 소리는 기보음보다 장6도 낮습니다.",
    concertLead: "알토 기준 실음(concert pitch)",
  },
  tenor: {
    prefix: "tenor",
    englishName: "Tenor Saxophone",
    koreanName: "테너 색소폰",
    instrumentTag: "Bb tenor sax",
    sheetMark: "Tenor sax · written pitch",
    transpositionSemitones: 14,
    transpositionText: "테너는 Bb 조 이조악기이므로 실제 소리는 기보음보다 장9도 낮습니다.",
    concertLead: "테너 기준 실음(concert pitch)",
  },
  soprano: {
    prefix: "soprano",
    englishName: "Soprano Saxophone",
    koreanName: "소프라노 색소폰",
    instrumentTag: "Bb soprano sax",
    sheetMark: "Soprano sax · written pitch",
    transpositionSemitones: 2,
    transpositionText: "소프라노는 Bb 조 이조악기이므로 실제 소리는 기보음보다 장2도 낮습니다.",
    concertLead: "소프라노 기준 실음(concert pitch)",
  },
};
const chartConfig = chartConfigs[requestedChartKind] || chartConfigs.alto;

const outDir = process.cwd();
const svgPath = resolve(outDir, `${chartConfig.prefix}-sax-fingering-chart.svg`);
const htmlPath = resolve(outDir, `${chartConfig.prefix}-sax-fingering-chart.html`);
const pdfPath = resolve(outDir, `${chartConfig.prefix}-sax-fingering-chart.pdf`);
const animationSvgPath = resolve(outDir, "sax-fingering-animation.svg");
const animationHtmlPath = resolve(outDir, "sax-fingering-animation.html");
const handPreviewPath = resolve(outDir, "hand-preview.html");

const keys = [
  { id: "ok", label: "OK", x: 90, y: 24, w: 38, h: 18, type: "pill", group: "thumb" },
  { id: "pD", label: "D", x: 18, y: 72, w: 28, h: 15, type: "pill", group: "palm" },
  { id: "pEb", label: "Eb", x: 18, y: 93, w: 28, h: 15, type: "pill", group: "palm" },
  { id: "pF", label: "F", x: 18, y: 114, w: 28, h: 15, type: "pill", group: "palm" },
  { id: "frontF", label: "Ff", x: 94, y: 64, r: 6, type: "circle", group: "aux" },
  { id: "lh1", label: "1", x: 94, y: 88, r: 9, type: "circle", group: "left" },
  { id: "bis", label: "Bb", x: 118, y: 104, r: 5, type: "circle", group: "aux" },
  { id: "lh2", label: "2", x: 94, y: 112, r: 9, type: "circle", group: "left" },
  { id: "lh3", label: "3", x: 94, y: 136, r: 9, type: "circle", group: "left" },
  { id: "gSharp", label: "G#", x: 42, y: 145, w: 30, h: 15, type: "pill", group: "left-pinky" },
  { id: "lowCSharp", label: "C#", x: 42, y: 165, w: 30, h: 15, type: "pill", group: "left-pinky" },
  { id: "lowB", label: "B", x: 42, y: 185, w: 30, h: 15, type: "pill", group: "left-pinky" },
  { id: "lowBb", label: "Bb", x: 42, y: 205, w: 30, h: 15, type: "pill", group: "left-pinky" },
  { id: "sideE", label: "E", x: 142, y: 148, w: 28, h: 15, type: "pill", group: "side" },
  { id: "sideC", label: "C", x: 142, y: 168, w: 28, h: 15, type: "pill", group: "side" },
  { id: "sideBb", label: "Bb", x: 142, y: 188, w: 28, h: 15, type: "pill", group: "side" },
  { id: "highFSharp", label: "hiF#", x: 174, y: 168, w: 31, h: 15, type: "pill", group: "side" },
  { id: "rh1", label: "1", x: 94, y: 174, r: 9, type: "circle", group: "right" },
  { id: "altFSharp", label: "trF#", x: 118, y: 190, r: 5, type: "circle", group: "right" },
  { id: "rh2", label: "2", x: 94, y: 198, r: 9, type: "circle", group: "right" },
  { id: "rh3", label: "3", x: 94, y: 222, r: 9, type: "circle", group: "right" },
  { id: "lowEb", label: "Eb", x: 118, y: 237, w: 30, h: 15, type: "pill", group: "right-pinky" },
  { id: "lowC", label: "C", x: 118, y: 257, w: 30, h: 15, type: "pill", group: "right-pinky" },
];

const FINGER_MAP = {
  ok: { hand: "lh", finger: "thumb", contact: "thumb" },
  frontF: { hand: "lh", finger: "index", contact: "tip" },
  lh1: { hand: "lh", finger: "index", contact: "pad" },
  bis: { hand: "lh", finger: "index", contact: "pad" },
  lh2: { hand: "lh", finger: "middle", contact: "pad" },
  lh3: { hand: "lh", finger: "ring", contact: "pad" },
  gSharp: { hand: "lh", finger: "pinky", contact: "tip" },
  lowCSharp: { hand: "lh", finger: "pinky", contact: "tip" },
  lowB: { hand: "lh", finger: "pinky", contact: "tip" },
  lowBb: { hand: "lh", finger: "pinky", contact: "tip" },
  pD: { hand: "lh", finger: "palm", contact: "palm" },
  pEb: { hand: "lh", finger: "palm", contact: "palm" },
  pF: { hand: "lh", finger: "palm", contact: "palm" },
  rh1: { hand: "rh", finger: "index", contact: "pad" },
  altFSharp: { hand: "rh", finger: "ring", contact: "tip" },
  sideE: { hand: "rh", finger: "index", contact: "knuckle" },
  sideC: { hand: "rh", finger: "index", contact: "knuckle" },
  sideBb: { hand: "rh", finger: "index", contact: "knuckle" },
  highFSharp: { hand: "rh", finger: "middle", contact: "tip" },
  rh2: { hand: "rh", finger: "middle", contact: "pad" },
  rh3: { hand: "rh", finger: "ring", contact: "pad" },
  lowEb: { hand: "rh", finger: "pinky", contact: "tip" },
  lowC: { hand: "rh", finger: "pinky", contact: "tip" },
};

const HAND_GEOMETRY = {
  lh: {
    origin: { x: 76, y: 112 },
    palmPath: "M49 64 C44 79 45 131 51 153 C55 168 69 175 82 168 C93 162 96 145 94 116 L93 82 C92 65 81 54 66 55 C58 56 52 59 49 64 Z",
    webbingPath: "M78 66 C86 59 94 55 103 54 C94 62 88 72 86 84",
    fingers: {
      thumb: { pivot: { x: 80, y: 66 }, rest: { x: 108, y: 48 }, lengths: [25, 18, 0], widths: [10.5, 8.2, 0], bend: 1 },
      index: { pivot: { x: 69, y: 88 }, rest: { x: 89, y: 73 }, lengths: [25, 16, 11], widths: [9.5, 7.6, 6.1], bend: -1 },
      middle: { pivot: { x: 69, y: 112 }, rest: { x: 91, y: 101 }, lengths: [27, 17, 12], widths: [10, 7.9, 6.2], bend: -1 },
      ring: { pivot: { x: 69, y: 136 }, rest: { x: 89, y: 127 }, lengths: [26, 16, 11], widths: [9.4, 7.4, 5.9], bend: -1 },
      pinky: { pivot: { x: 68, y: 154 }, rest: { x: 61, y: 166 }, lengths: [15, 11, 8], widths: [8.2, 6.3, 5], bend: 1 },
    },
  },
  rh: {
    origin: { x: 142, y: 207 },
    palmPath: "M126 154 C118 169 118 218 124 242 C128 258 140 266 152 258 C161 252 162 232 160 205 L159 176 C158 159 149 148 137 148 C132 148 128 151 126 154 Z",
    webbingPath: "M137 223 C130 229 123 235 115 239 C124 238 134 241 141 247",
    fingers: {
      thumb: { pivot: { x: 139, y: 224 }, rest: { x: 119, y: 231 }, lengths: [20, 16, 0], widths: [10.8, 8.5, 0], bend: 1 },
      index: { pivot: { x: 132, y: 173 }, rest: { x: 108, y: 166 }, lengths: [26, 16, 11], widths: [9.5, 7.6, 6.1], bend: 1 },
      middle: { pivot: { x: 132, y: 197 }, rest: { x: 105, y: 193 }, lengths: [30, 18, 13], widths: [10, 7.9, 6.2], bend: 1 },
      ring: { pivot: { x: 132, y: 221 }, rest: { x: 107, y: 218 }, lengths: [27, 17, 12], widths: [9.4, 7.4, 5.9], bend: 1 },
      pinky: { pivot: { x: 136, y: 238 }, rest: { x: 127, y: 249 }, lengths: [13, 10, 7], widths: [8.2, 6.3, 5], bend: -1 },
    },
  },
};

const HAND_POSES = {
  REST: { mcp: 8, pip: 12, dip: 6 },
  PRESS_READY: { mcp: 14, pip: 18, dip: 8 },
  PRESS: { mcp: 22, pip: 27, dip: 10 },
};

const POSE_TABLE = Object.fromEntries(keys.map((key) => [key.id, {
  keyId: key.id,
  hand: FINGER_MAP[key.id].hand,
  finger: FINGER_MAP[key.id].finger,
  contact: FINGER_MAP[key.id].contact,
  target: key.type === "circle"
    ? { x: key.x, y: key.y }
    : { x: key.x + key.w / 2, y: key.y + key.h / 2 },
  correction: { x: 0, y: 0 },
}]));

const notes = [
  n("Bb3 / A#3", 58, ["lh1", "lh2", "lh3", "lowBb", "rh1", "rh2", "rh3", "lowC"], "Low Bb", "LH 123 + low Bb | RH 123 + low C", "저음 B-flat"),
  n("B3 / Cb4", 59, ["lh1", "lh2", "lh3", "lowB", "rh1", "rh2", "rh3", "lowC"], "Low B", "LH 123 + low B | RH 123 + low C", ""),
  n("C4 / B#3", 60, ["lh1", "lh2", "lh3", "rh1", "rh2", "rh3", "lowC"], "Low C", "LH 123 | RH 123 + low C", ""),
  n("C#4 / Db4", 61, ["lh1", "lh2", "lh3", "lowCSharp", "rh1", "rh2", "rh3", "lowC"], "Low C#", "LH 123 + low C# | RH 123 + low C", ""),
  n("D4", 62, ["lh1", "lh2", "lh3", "rh1", "rh2", "rh3"], "Low D", "LH 123 | RH 123", ""),
  n("Eb4 / D#4", 63, ["lh1", "lh2", "lh3", "rh1", "rh2", "rh3", "lowEb"], "Low Eb", "LH 123 | RH 123 + low Eb", ""),
  n("E4 / Fb4", 64, ["lh1", "lh2", "lh3", "rh1", "rh2"], "Low E", "LH 123 | RH 12", ""),
  n("F4 / E#4", 65, ["lh1", "lh2", "lh3", "rh1"], "Low F", "LH 123 | RH 1", ""),
  n("F#4 / Gb4", 66, ["lh1", "lh2", "lh3", "rh2"], "Low F#", "LH 123 | RH 2", "Alt: LH123 | RH1 + trF#"),
  n("G4", 67, ["lh1", "lh2", "lh3"], "G", "LH 123 | open RH", ""),
  n("G#4 / Ab4", 68, ["lh1", "lh2", "lh3", "gSharp"], "G#", "LH 123 + G# | open RH", ""),
  n("A4", 69, ["lh1", "lh2"], "A", "LH 12 | open RH", ""),
  n("Bb4 / A#4", 70, ["lh1", "sideBb"], "Bb", "LH 1 + side Bb", "Alt: LH1 + Bis Bb"),
  n("B4 / Cb5", 71, ["lh1"], "B", "LH 1 | open RH", ""),
  n("C5 / B#4", 72, ["lh2"], "C", "LH 2 | open RH", "Alt: LH1 + side C"),
  n("C#5 / Db5", 73, [], "C#", "Open", "중간 C#"),
  n("D5", 74, ["ok", "lh1", "lh2", "lh3", "rh1", "rh2", "rh3"], "D + octave", "OK + LH 123 | RH 123", ""),
  n("Eb5 / D#5", 75, ["ok", "lh1", "lh2", "lh3", "rh1", "rh2", "rh3", "lowEb"], "Eb + octave", "OK + LH 123 | RH 123 + low Eb", ""),
  n("E5 / Fb5", 76, ["ok", "lh1", "lh2", "lh3", "rh1", "rh2"], "E + octave", "OK + LH 123 | RH 12", ""),
  n("F5 / E#5", 77, ["ok", "lh1", "lh2", "lh3", "rh1"], "F + octave", "OK + LH 123 | RH 1", ""),
  n("F#5 / Gb5", 78, ["ok", "lh1", "lh2", "lh3", "rh2"], "F# + octave", "OK + LH 123 | RH 2", "Alt: OK + LH123 | RH1 + trF#"),
  n("G5", 79, ["ok", "lh1", "lh2", "lh3"], "G + octave", "OK + LH 123 | open RH", ""),
  n("G#5 / Ab5", 80, ["ok", "lh1", "lh2", "lh3", "gSharp"], "G# + octave", "OK + LH 123 + G# | open RH", ""),
  n("A5", 81, ["ok", "lh1", "lh2"], "A + octave", "OK + LH 12 | open RH", ""),
  n("Bb5 / A#5", 82, ["ok", "lh1", "sideBb"], "Bb + octave", "OK + LH1 + side Bb", "Alt: OK + LH1 + Bis Bb"),
  n("B5 / Cb6", 83, ["ok", "lh1"], "B + octave", "OK + LH1 | open RH", ""),
  n("C6 / B#5", 84, ["ok", "lh2"], "C + octave", "OK + LH2 | open RH", "Alt: OK + LH1 + side C"),
  n("C#6 / Db6", 85, ["ok"], "C# + octave", "OK only", ""),
  n("D6", 86, ["ok", "pD"], "Palm D", "OK + palm D", "3옥타브 D"),
  n("Eb6 / D#6", 87, ["ok", "pD", "pEb"], "Palm Eb", "OK + palm D + palm Eb", ""),
  n("E6 / Fb6", 88, ["ok", "pD", "pEb", "sideE"], "High E", "OK + palm D/Eb + side E", ""),
  n("F6 / E#6", 89, ["ok", "pD", "pEb", "pF", "sideE"], "High F", "OK + palm D/Eb/F + side E", ""),
  n("F#6 / Gb6", 90, ["ok", "pD", "pEb", "pF", "sideE", "highFSharp"], "High F#", "OK + palm D/Eb/F + side E + high F# key", "high F# key 장착 모델"),
];

const printPages = [
  { title: "1. Low Register", subtitle: "Written Bb3-Gb4", items: notes.slice(0, 9) },
  { title: "2. First Register", subtitle: "Written G4-Eb5", items: notes.slice(9, 18) },
  { title: "3. Octave-Key Register", subtitle: "Written E5-C6", items: notes.slice(18, 27) },
  { title: "4. Top Register", subtitle: "Written C#6-F#6", items: notes.slice(27) },
];

function n(label, midi, pressed, short, formula, note) {
  return { label, midi, pressed, short, formula, note, solfege: solfegeName(label) };
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pitchClassName(midi) {
  const names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function primaryPitch(label) {
  return label.split("/")[0].trim();
}

function solfegeName(label) {
  const pitch = String(label).split("/")[0].trim();
  const match = pitch.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!match) return pitch.replaceAll("#", "♯").replaceAll("b", "♭");
  const syllables = { C: "도", D: "레", E: "미", F: "파", G: "솔", A: "라", B: "시" };
  const accidentalMark = match[2] === "#" ? "♯" : match[2] === "b" ? "♭" : "";
  return `${syllables[match[1]]}${accidentalMark}${match[3]}`;
}

function derivePoses(pressedInput, fingerMap, keySpecs, handGeometry) {
  const fingerNames = ["thumb", "index", "middle", "ring", "pinky"];
  const pressed = [...new Set((pressedInput || []).filter((keyId) => fingerMap[keyId]))];
  const pressedSet = new Set(pressed);
  const keyById = Object.fromEntries(keySpecs.map((key) => [key.id, key]));
  const centerOf = (key) => key.type === "circle"
    ? { x: key.x, y: key.y }
    : { x: key.x + key.w / 2, y: key.y + key.h / 2 };
  const pointAt = (point, angle, length) => ({
    x: point.x + Math.cos(angle) * length,
    y: point.y + Math.sin(angle) * length,
  });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const solveTwo = (pivot, target, l1, l2, bend) => {
    const dx = target.x - pivot.x;
    const dy = target.y - pivot.y;
    const rawDistance = Math.hypot(dx, dy);
    const minimum = Math.abs(l1 - l2) + 0.001;
    const maximum = l1 + l2 - 0.001;
    const length = Math.max(minimum, Math.min(maximum, rawDistance || minimum));
    const direction = rawDistance ? Math.atan2(dy, dx) : 0;
    const shoulder = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + length * length - l2 * l2) / (2 * l1 * length))));
    const angle1 = direction + bend * shoulder;
    const joint1 = pointAt(pivot, angle1, l1);
    const wristTarget = pointAt(pivot, direction, length);
    const angle2 = Math.atan2(wristTarget.y - joint1.y, wristTarget.x - joint1.x);
    const joint2 = pointAt(joint1, angle2, l2);
    return { angle1, angle2, joint1, joint2, reachable: rawDistance >= minimum && rawDistance <= maximum };
  };
  const solveThree = (pivot, target, lengths, bend) => {
    const [l1, l2, l3] = lengths;
    if (!l3) {
      const solved = solveTwo(pivot, target, l1, l2, bend);
      return {
        ...solved,
        angle3: solved.angle2,
        tip: solved.joint2,
        error: distance(solved.joint2, target),
      };
    }
    const evaluate = (angle3) => {
      const wristTarget = {
        x: target.x - Math.cos(angle3) * l3,
        y: target.y - Math.sin(angle3) * l3,
      };
      const solved = solveTwo(pivot, wristTarget, l1, l2, bend);
      const tip = pointAt(solved.joint2, angle3, l3);
      return { ...solved, angle3, tip, error: distance(tip, target) };
    };
    let best = null;
    const fullStep = Math.PI * 2 / 72;
    for (let angle = -Math.PI; angle < Math.PI; angle += fullStep) {
      const candidate = evaluate(angle);
      if (!best || candidate.error < best.error) best = candidate;
    }
    let step = fullStep;
    for (let pass = 0; pass < 4; pass += 1) {
      step /= 5;
      for (let offset = -5; offset <= 5; offset += 1) {
        const candidate = evaluate(best.angle3 + offset * step);
        if (candidate.error < best.error) best = candidate;
      }
    }
    return best;
  };
  const inverseRoot = (point, root, origin) => {
    const translated = { x: point.x - root.tx, y: point.y - root.ty };
    const angle = -toRadians(root.rotation);
    const dx = translated.x - origin.x;
    const dy = translated.y - origin.y;
    return {
      x: origin.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: origin.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  };
  const forwardRoot = (point, root, origin) => {
    const angle = toRadians(root.rotation);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return {
      x: origin.x + dx * Math.cos(angle) - dy * Math.sin(angle) + root.tx,
      y: origin.y + dx * Math.sin(angle) + dy * Math.cos(angle) + root.ty,
    };
  };
  const tableDepth = pressedSet.has("lowBb") ? 28 : pressedSet.has("lowB") ? 20 : pressedSet.has("lowCSharp") ? 10 : 0;
  const palmActive = pressedSet.has("pD") || pressedSet.has("pEb") || pressedSet.has("pF");
  const sideActive = pressedSet.has("sideE") || pressedSet.has("sideC") || pressedSet.has("sideBb") || pressedSet.has("highFSharp");
  const roots = {
    lh: palmActive ? { tx: -4, ty: -1, rotation: 8 } : { tx: 0, ty: tableDepth, rotation: 0 },
    rh: sideActive ? { tx: 4, ty: -2, rotation: -4 } : { tx: 0, ty: 0, rotation: 0 },
  };
  const result = { pressed, contacts: {}, lh: null, rh: null };

  ["lh", "rh"].forEach((side) => {
    const geometry = handGeometry[side];
    const root = roots[side];
    const hand = {
      side,
      root: { ...root, cx: geometry.origin.x, cy: geometry.origin.y },
      palmPath: geometry.palmPath,
      webbingPath: geometry.webbingPath,
      palmPress: side === "lh" && palmActive,
      label: side === "lh" ? "왼손 색소폰 운지" : "오른손 색소폰 운지",
      fingers: {},
    };
    const activeFingerNames = new Set();

    fingerNames.forEach((fingerName) => {
      const calibration = geometry.fingers[fingerName];
      const assignments = pressed.filter((keyId) => {
        const mapping = fingerMap[keyId];
        return mapping.hand === side && mapping.finger === fingerName;
      });
      const active = assignments.length > 0;
      if (active) activeFingerNames.add(fingerName);
      let target = calibration.rest;
      if (active) {
        const targets = assignments.map((keyId) => centerOf(keyById[keyId]));
        target = {
          x: targets.reduce((sum, point) => sum + point.x, 0) / targets.length,
          y: targets.reduce((sum, point) => sum + point.y, 0) / targets.length,
        };
      }
      const localTarget = inverseRoot(target, root, geometry.origin);
      const solved = solveThree(calibration.pivot, localTarget, calibration.lengths, calibration.bend);
      const contact = active ? fingerMap[assignments[0]].contact : null;
      const pose = {
        name: fingerName,
        pivot: { ...calibration.pivot },
        lengths: [...calibration.lengths],
        widths: [...calibration.widths],
        bend: calibration.bend,
        angles: { mcp: solved.angle1, pip: solved.angle2, dip: solved.angle3 },
        points: { joint1: solved.joint1, joint2: solved.joint2, tip: solved.tip },
        active,
        keyIds: assignments,
        contact,
        press: active,
        error: solved.error,
      };
      hand.fingers[fingerName] = pose;

      assignments.forEach((keyId) => {
        const keyTarget = centerOf(keyById[keyId]);
        const actual = forwardRoot(solved.tip, root, geometry.origin);
        result.contacts[keyId] = {
          x: keyTarget.x,
          y: keyTarget.y,
          actualX: actual.x,
          actualY: actual.y,
          error: distance(actual, keyTarget),
          hand: side,
          finger: fingerName,
          contact: fingerMap[keyId].contact,
        };
      });
    });

    ["index", "middle", "ring", "pinky"].forEach((fingerName, index, ordered) => {
      const pose = hand.fingers[fingerName];
      if (pose.active) return;
      const neighborNames = [ordered[index - 1], ordered[index + 1]].filter(Boolean);
      const activeNeighbors = neighborNames.map((name) => hand.fingers[name]).filter((finger) => finger.active);
      if (!activeNeighbors.length) return;
      const source = activeNeighbors[0].angles;
      pose.angles = {
        mcp: pose.angles.mcp + (source.mcp - pose.angles.mcp) * 0.25,
        pip: pose.angles.pip + (source.pip - pose.angles.pip) * 0.25,
        dip: pose.angles.dip + (source.dip - pose.angles.dip) * 0.25,
      };
    });

    result[side] = hand;
  });

  pressed.forEach((keyId) => {
    if (fingerMap[keyId].finger !== "palm") return;
    const point = centerOf(keyById[keyId]);
    result.contacts[keyId] = {
      x: point.x,
      y: point.y,
      actualX: point.x,
      actualY: point.y,
      error: 0,
      hand: fingerMap[keyId].hand,
      finger: "palm",
      contact: "palm",
    };
  });
  return result;
}

function buildHand(side, pose, prefix = "hand") {
  const round = (value) => Number(value.toFixed(3));
  const degrees = (value) => round(value * 180 / Math.PI);
  const escapeAttribute = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const gradientId = `${prefix}-${side}-skin`;
  const shadowId = `${prefix}-${side}-shadow`;
  const segmentPath = (length, startWidth, endWidth) => {
    const start = startWidth / 2;
    const end = endWidth / 2;
    return `M0 ${round(-start)} L${round(length)} ${round(-end)} Q${round(length + end * 0.72)} 0 ${round(length)} ${round(end)} L0 ${round(start)} Q${round(-start * 0.72)} 0 0 ${round(-start)} Z`;
  };
  const creaseMarkup = (length, width, count = 2) => Array.from({ length: count }, (_, index) => {
    const x = length * (0.78 + index * 0.08);
    return `<path class="hand-crease" d="M${round(x)} ${round(-width * 0.24)} Q${round(x + 1.1)} 0 ${round(x)} ${round(width * 0.24)}"/>`;
  }).join("");
  const fingerMarkup = (finger) => {
    const [l1, l2, l3] = finger.lengths;
    const [w1, w2, w3] = finger.widths;
    const mcp = degrees(finger.angles.mcp);
    const pip = degrees(finger.angles.pip - finger.angles.mcp);
    const dip = degrees(finger.angles.dip - finger.angles.pip);
    const activeClass = finger.active ? " is-pressed" : "";
    const distalScale = finger.active ? 0.94 : 1;
    const nailOnSecond = !l3;
    const nailSecond = nailOnSecond
      ? `<ellipse class="hand-nail" cx="${round(l2 * 0.68)}" cy="${round(-w2 * 0.08)}" rx="${round(Math.max(3.2, l2 * 0.2))}" ry="${round(w2 * 0.25)}"/>`
      : "";
    const distal = l3 ? `<g class="joint joint-dip" data-joint="dip" transform="translate(${round(l2)} 0) rotate(${dip}) scale(${distalScale} 1)">
          <path class="hand-segment seg-distal" d="${segmentPath(l3, w2 * 0.9, w3)}"/>
          <ellipse class="hand-nail" cx="${round(l3 * 0.64)}" cy="${round(-w3 * 0.08)}" rx="${round(Math.max(2.5, l3 * 0.24))}" ry="${round(w3 * 0.27)}"/>
          <ellipse class="finger-contact-shadow" cx="${round(l3 + w3 * 0.12)}" cy="1" rx="${round(w3 * 0.52)}" ry="${round(w3 * 0.25)}" style="opacity:${finger.active ? 1 : 0}"/>
        </g>` : `<ellipse class="finger-contact-shadow" cx="${round(l2 + w2 * 0.12)}" cy="1" rx="${round(w2 * 0.52)}" ry="${round(w2 * 0.25)}" style="opacity:${finger.active ? 1 : 0}"/>`;
    return `<g class="finger finger-${finger.name}${activeClass}" data-finger="${finger.name}" transform="translate(${round(finger.pivot.x)} ${round(finger.pivot.y)}) rotate(${mcp})">
      <path class="hand-segment seg-proximal" d="${segmentPath(l1, w1, w2 * 1.04)}"/>
      ${creaseMarkup(l1, w2)}
      <g class="joint joint-pip" data-joint="pip" transform="translate(${round(l1)} 0) rotate(${pip})">
        <path class="hand-segment seg-middle" d="${segmentPath(l2, w2, (l3 ? w3 * 1.08 : w2 * 0.78))}"/>
        ${creaseMarkup(l2, l3 ? w3 : w2 * 0.76, 2)}
        ${nailSecond}
        ${distal}
      </g>
    </g>`;
  };
  const root = pose.root;
  const rootTransform = `translate(${round(root.tx)} ${round(root.ty)}) rotate(${round(root.rotation)} ${round(root.cx)} ${round(root.cy)})`;
  const fingers = ["thumb", "index", "middle", "ring", "pinky"].map((name) => fingerMarkup(pose.fingers[name])).join("");
  return `<g class="hand hand-${side}${pose.palmPress ? " is-palm-pressed" : ""}" id="${prefix}-hand-${side}" data-hand="${side}" role="img" aria-label="${escapeAttribute(pose.label)}" transform="${rootTransform}">
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f8cfae"/><stop offset="0.5" stop-color="#f3bc98"/><stop offset="1" stop-color="#e8a87d"/>
      </linearGradient>
      <filter id="${shadowId}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1"/></filter>
    </defs>
    <path class="hand-palm" d="${pose.palmPath}" style="fill:url(#${gradientId})"/>
    <path class="hand-webbing" d="${pose.webbingPath}"/>
    ${fingers}
  </g>`;
}

function validatePoseTable(keySpecs, fingerMap, handGeometry) {
  return keySpecs.map((key) => {
    const frame = derivePoses([key.id], fingerMap, keySpecs, handGeometry);
    const contact = frame.contacts[key.id];
    return { keyId: key.id, error: contact?.error ?? Number.POSITIVE_INFINITY };
  }).filter((result) => result.error > 1.5);
}

function accidental(label) {
  const pitch = primaryPitch(label);
  if (pitch.includes("#")) return "#";
  if (pitch.includes("b")) return "b";
  return "";
}

function naturalFromLabel(label) {
  const pitch = primaryPitch(label);
  const match = pitch.match(/^([A-G])(?:#|b)?(\d)$/);
  if (!match) return { letter: "C", octave: 4 };
  return { letter: match[1], octave: Number(match[2]) };
}

function staffSvg(note, scale = 1) {
  const width = 132 * scale;
  const height = 72 * scale;
  const left = 18 * scale;
  const right = 122 * scale;
  const bottomY = 50 * scale;
  const lineSpacing = 7 * scale;
  const step = lineSpacing / 2;
  const letterOrder = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const { letter, octave } = naturalFromLabel(note.label);
  const e4Index = 4 * 7 + letterOrder.E;
  const noteIndex = octave * 7 + letterOrder[letter];
  const y = bottomY - (noteIndex - e4Index) * step;
  const cx = 74 * scale;
  const rx = 9 * scale;
  const ry = 6.5 * scale;
  const lines = [];
  for (let i = 0; i < 5; i++) {
    const ly = bottomY - i * lineSpacing;
    lines.push(`<line x1="${left}" y1="${ly}" x2="${right}" y2="${ly}" class="staff-line"/>`);
  }
  const staffTop = bottomY - 4 * lineSpacing;
  for (let ly = staffTop - lineSpacing; ly >= y - 0.1; ly -= lineSpacing) {
    lines.push(`<line x1="${cx - 17 * scale}" y1="${ly}" x2="${cx + 17 * scale}" y2="${ly}" class="ledger"/>`);
  }
  for (let ly = bottomY + lineSpacing; ly <= y + 0.1; ly += lineSpacing) {
    lines.push(`<line x1="${cx - 17 * scale}" y1="${ly}" x2="${cx + 17 * scale}" y2="${ly}" class="ledger"/>`);
  }
  const acc = accidental(note.label);
  const accText = acc ? `<text x="${cx - 27 * scale}" y="${y + 5 * scale}" class="accidental">${acc}</text>` : "";
  const stemUp = y >= (staffTop + bottomY) / 2;
  const stemX = stemUp ? cx + rx * 0.8 : cx - rx * 0.8;
  const stemY2 = stemUp ? y - 31 * scale : y + 31 * scale;
  const stem = `<line x1="${stemX}" y1="${y}" x2="${stemX}" y2="${stemY2}" class="stem"/>`;
  return `<svg class="staff" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(note.label)} staff">
    ${lines.join("")}
    ${accText}
    <ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" class="notehead" transform="rotate(-18 ${cx} ${y})"/>
    ${stem}
  </svg>`;
}

function diagramSvg(pressed, scale = 1, className = "diagram") {
  const pressedSet = new Set(pressed);
  const width = 224 * scale;
  const height = 292 * scale;
  const body = keys
    .map((key) => {
      const active = pressedSet.has(key.id);
      const cls = active ? "key active" : "key";
      if (key.type === "circle") {
        return `<g class="${cls}"><circle cx="${key.x * scale}" cy="${key.y * scale}" r="${key.r * scale}"/><text x="${key.x * scale}" y="${(key.y + 3) * scale}">${esc(key.label)}</text></g>`;
      }
      return `<g class="${cls}"><rect x="${key.x * scale}" y="${key.y * scale}" width="${key.w * scale}" height="${key.h * scale}" rx="${7 * scale}"/><text x="${(key.x + key.w / 2) * scale}" y="${(key.y + key.h / 2 + 3) * scale}">${esc(key.label)}</text></g>`;
    })
    .join("");
  return `<svg class="${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="pressed keys">
    <line x1="${94 * scale}" y1="${45 * scale}" x2="${94 * scale}" y2="${238 * scale}" class="body-line"/>
    <line x1="${78 * scale}" y1="${155 * scale}" x2="${110 * scale}" y2="${155 * scale}" class="hand-sep"/>
    <text x="${94 * scale}" y="${49 * scale}" class="hand-label">LH</text>
    <text x="${94 * scale}" y="${160 * scale}" class="hand-label">RH</text>
    ${body}
  </svg>`;
}

function htmlCard(note) {
  const concert = pitchClassName(note.midi - chartConfig.transpositionSemitones);
  return `<article class="card">
    <header>
      <div>
        <h3>${esc(note.label)}</h3>
        <p>${esc(note.short)}</p>
      </div>
      <div class="concert">실음 ${esc(concert)}</div>
    </header>
    <div class="visuals">
      ${staffSvg(note)}
      ${diagramSvg(note.pressed)}
    </div>
    <div class="formula">${esc(note.formula)}</div>
    ${note.note ? `<div class="note">${esc(note.note)}</div>` : ""}
  </article>`;
}

function posterCard(note, x, y) {
  const concert = pitchClassName(note.midi - chartConfig.transpositionSemitones);
  return `<g transform="translate(${x},${y})" class="poster-card">
    <rect width="500" height="230" rx="14" class="poster-card-bg"/>
    <text x="24" y="44" class="poster-note">${esc(note.label)}</text>
    <text x="24" y="72" class="poster-sub">${esc(note.short)} · 실음 ${esc(concert)}</text>
    <g transform="translate(20,82)">${staffSvg(note, 1.35)}</g>
    <g transform="translate(244,0)">${diagramSvg(note.pressed, 0.74, "diagram poster-diagram")}</g>
    <text x="24" y="204" class="poster-formula">${esc(note.formula)}</text>
    ${note.note ? `<text x="24" y="222" class="poster-foot">${esc(note.note)}</text>` : ""}
  </g>`;
}

function posterLegend(x, y) {
  return `<g transform="translate(${x},${y})" class="legend">
    <rect width="1540" height="122" rx="18" class="legend-bg"/>
    <text x="26" y="38" class="legend-title">표기 기준</text>
    <g transform="translate(190,24)">
      <circle cx="18" cy="12" r="9" class="sample-filled"/><text x="38" y="17" class="legend-text">채움 = 누르는 키/닫는 키</text>
      <circle cx="258" cy="12" r="9" class="sample-open"/><text x="278" y="17" class="legend-text">빈 원 = 열림</text>
      <rect x="472" y="3" width="40" height="18" rx="9" class="sample-filled"/><text x="524" y="17" class="legend-text">OK = octave key</text>
      <rect x="744" y="3" width="48" height="18" rx="9" class="sample-filled"/><text x="804" y="17" class="legend-text">palm/side/pinky keys는 라벨 그대로 누름</text>
    </g>
    <text x="26" y="82" class="legend-note">${esc(chartConfig.koreanName)} 기보음 기준입니다. ${esc(chartConfig.transpositionText)}</text>
    <text x="26" y="108" class="legend-note">High F#는 high F# key가 있는 현대 악기 기준입니다. 없는 악기는 악기별 altissimo 대체운지가 필요합니다.</text>
  </g>`;
}

function makePosterSvg() {
  const cardW = 500;
  const cardH = 230;
  const gap = 24;
  const cols = 3;
  const margin = 60;
  const top = 244;
  const rows = Math.ceil(notes.length / cols);
  const width = margin * 2 + cols * cardW + (cols - 1) * gap;
  const height = top + rows * cardH + (rows - 1) * gap + 90;
  const cards = notes.map((note, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return posterCard(note, margin + col * (cardW + gap), top + row * (cardH + gap));
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${esc(chartConfig.englishName)} Fingering Chart</title>
  <desc id="desc">Written-pitch ${esc(chartConfig.englishName.toLowerCase())} fingering chart from low Bb to high F#.</desc>
  <style>${sharedSvgCss()}</style>
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <text x="${margin}" y="72" class="poster-title">${esc(chartConfig.englishName)} Fingering Chart</text>
  <text x="${margin}" y="112" class="poster-korean">${esc(chartConfig.koreanName)} 운지표 · 기보음 low Bb부터 high F#까지</text>
  <text x="${margin}" y="148" class="poster-lead">Written pitch 기준, 각 카드에는 ${esc(chartConfig.concertLead)}도 함께 표기했습니다.</text>
  ${posterLegend(margin, 170)}
  ${cards.join("")}
  <text x="${margin}" y="${height - 36}" class="poster-source">Sources checked: Yamaha Musical Instrument Guide, Woodwind Fingering Guide, Taming The Saxophone, Sax School.</text>
</svg>`;
}

function makeHtml() {
  const pages = printPages
    .map((page) => `<section class="sheet">
      <div class="sheet-head">
        <div>
          <h2>${esc(page.title)}</h2>
          <p>${esc(page.subtitle)}</p>
        </div>
        <div class="sheet-mark">${esc(chartConfig.sheetMark)}</div>
      </div>
      <div class="card-grid">${page.items.map(htmlCard).join("")}</div>
    </section>`)
    .join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(chartConfig.englishName)} Fingering Chart / ${esc(chartConfig.koreanName)} 운지표</title>
  <style>${htmlCss()}</style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">Written pitch · ${esc(chartConfig.instrumentTag)}</p>
        <h1>${esc(chartConfig.englishName)} Fingering Chart</h1>
        <p class="subtitle">${esc(chartConfig.koreanName)} 운지표: 기보음 low Bb부터 high F#까지, 표준 운지와 핵심 대체 운지 메모를 함께 정리했습니다.</p>
      </div>
      <div class="legend-box">
        <div><span class="dot filled"></span>누름/닫힘</div>
        <div><span class="dot open"></span>열림</div>
        <div><span class="pill">OK</span>옥타브 키</div>
        <p>${esc(chartConfig.transpositionText)} High F#는 high F# key가 있는 악기 기준입니다.</p>
      </div>
    </section>
    ${pages}
    <section class="sources">
      <h2>검수 기준</h2>
      <p>표준 운지의 악기 공통성, 키 명칭, palm/side key 조합을 아래 자료로 대조했습니다.</p>
      <ul>
        <li><a href="https://www.yamaha.com/en/musical_instrument_guide/saxophone/play/play002.html">Yamaha Musical Instrument Guide: Saxophone fingering</a></li>
        <li><a href="https://www.wfg.woodwind.org/sax/sax_fing.html">The Woodwind Fingering Guide: Fingering Scheme for Saxophone</a></li>
        <li><a href="https://www.wfg.woodwind.org/sax/sax_alt_2.html">The Woodwind Fingering Guide: Second Octave Saxophone Fingerings</a></li>
        <li><a href="https://tamingthesaxophone.com/lessons/beginners/fingering-chart">Taming The Saxophone: Fingering Charts</a></li>
        <li><a href="https://saxschoolonline.com/articles/high-f-on-saxophone-a-beginners-guide/">Sax School: High F on Saxophone</a></li>
      </ul>
    </section>
  </main>
</body>
</html>`;
}

function makeHandPreviewHtml() {
  const initial = derivePoses(notes[0].pressed, FINGER_MAP, keys, HAND_GEOMETRY);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hand Rig Preview / 손 SVG 리그 프리뷰</title>
  <style>
    :root{--paper:#f8fafc;--ink:#0f172a;--line:#cbd5e1;--accent:#0f766e}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,"Malgun Gothic",sans-serif}
    main{max-width:1240px;margin:0 auto;padding:28px 18px 60px}h1{margin:0 0 8px;font-size:34px}.lead{margin:0 0 20px;color:#475569}
    .toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:16px}.toolbar label{display:grid;gap:5px;font-size:12px;font-weight:800}
    select,button,input{font:700 14px Arial,"Malgun Gothic",sans-serif}select,button{min-height:44px;border:1px solid var(--line);border-radius:9px;background:#fff;padding:0 12px}button{cursor:pointer}
    .preview-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);gap:18px}.stage{min-height:620px;border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden}
    #preview-stage{display:block;width:100%;height:620px}.key circle,.key rect{fill:#fff;stroke:#64748b;stroke-width:1.2}.key.active circle,.key.active rect{fill:#111827}.key text{font:700 6px Arial;fill:#475569;text-anchor:middle;dominant-baseline:middle}.key.active text{fill:#fff}
    ${handSvgCss()}
    .panel{border:1px solid var(--line);border-radius:16px;background:#fff;padding:16px}.panel h2{margin:0 0 12px;font-size:18px}.sliders{display:grid;gap:10px;max-height:500px;overflow:auto;padding-right:5px}
    .finger-controls{border-top:1px solid #e2e8f0;padding-top:9px}.finger-controls strong{display:block;margin-bottom:5px}.joint-control{display:grid;grid-template-columns:38px 1fr 48px;align-items:center;gap:7px;font-size:11px}.joint-control output{text-align:right;font-family:monospace}
    pre{max-height:220px;overflow:auto;margin:14px 0 0;padding:12px;border-radius:10px;background:#0f172a;color:#e2e8f0;font-size:11px}
    @media(max-width:820px){.preview-grid{grid-template-columns:1fr}.stage{min-height:430px}#preview-stage{height:430px}}
  </style>
</head>
<body><main>
  <h1>해부학적 양손 SVG 리그 프리뷰</h1>
  <p class="lead">마디 테이퍼·손톱·관절 주름·스킨 음영·엄지 물갈퀴·접점 압착을 독립 화면에서 점검합니다.</p>
  <div class="toolbar">
    <label>음<select id="preview-note"></select></label>
    <button id="preset-rest" type="button">REST</button>
    <button id="preset-press" type="button">PRESS</button>
    <button id="copy-pose" type="button">포즈 JSON 복사</button>
  </div>
  <div class="preview-grid">
    <section class="stage">
      <svg id="preview-stage" viewBox="0 0 224 292" role="img" aria-label="양손 색소폰 운지 리그 프리뷰">
        <defs><pattern id="preview-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#e2e8f0" stroke-width=".45"/></pattern></defs>
        <rect width="224" height="292" fill="url(#preview-grid)"/>
        <line x1="94" y1="45" x2="94" y2="238" stroke="#94a3b8" stroke-width="1.5"/>
        <g id="preview-keys"></g><g id="preview-hands">${buildHand("lh", initial.lh, "preview")}${buildHand("rh", initial.rh, "preview")}</g>
        <g id="preview-contacts"></g>
      </svg>
    </section>
    <aside class="panel"><h2>관절 각도</h2><div id="preview-sliders" class="sliders"></div><pre id="preview-json"></pre></aside>
  </div>
</main>
<script>
(() => {
  const DATA = ${animationDataJson()};
  const buildHand = ${buildHand.toString()};
  const derivePoses = ${derivePoses.toString()};
  const select = document.getElementById("preview-note");
  const keyLayer = document.getElementById("preview-keys");
  const handLayer = document.getElementById("preview-hands");
  const contactLayer = document.getElementById("preview-contacts");
  const sliders = document.getElementById("preview-sliders");
  let noteIndex = 0;
  let frame = derivePoses(DATA.notes[0].pressed, DATA.fingerMap, DATA.keys, DATA.handGeometry);
  const center = (key) => key.type === "circle" ? {x:key.x,y:key.y} : {x:key.x+key.w/2,y:key.y+key.h/2};
  const renderKeys = () => {
    const pressed = new Set(frame.pressed);
    keyLayer.innerHTML = DATA.keys.map((key) => {
      const c = center(key); const active = pressed.has(key.id); const cls = active ? "key active" : "key";
      const shape = key.type === "circle" ? '<circle cx="'+key.x+'" cy="'+key.y+'" r="'+key.r+'"/>' : '<rect x="'+key.x+'" y="'+key.y+'" width="'+key.w+'" height="'+key.h+'" rx="6"/>';
      return '<g class="'+cls+'">'+shape+'<text x="'+c.x+'" y="'+(c.y+2.5)+'">'+key.label+'</text></g>';
    }).join("");
  };
  const render = (rebuildControls = false) => {
    handLayer.innerHTML = buildHand("lh", frame.lh, "preview") + buildHand("rh", frame.rh, "preview");
    contactLayer.innerHTML = Object.values(frame.contacts).map((point) => '<circle class="hand-contact-dot" cx="'+point.x+'" cy="'+point.y+'" r="2.6"/>').join("");
    renderKeys();
    document.getElementById("preview-json").textContent = JSON.stringify({lh:frame.lh.root,rh:frame.rh.root,fingers:{lh:frame.lh.fingers,rh:frame.rh.fingers}}, null, 2);
    if (rebuildControls) buildControls();
  };
  const buildControls = () => {
    sliders.replaceChildren();
    ["lh","rh"].forEach((side) => ["thumb","index","middle","ring","pinky"].forEach((fingerName) => {
      const box = document.createElement("div"); box.className = "finger-controls"; box.innerHTML = '<strong>'+(side === "lh" ? "왼손 " : "오른손 ")+fingerName+'</strong>';
      [["mcp","MCP"],["pip","PIP"],["dip","DIP"]].forEach(([joint,label]) => {
        const row = document.createElement("label"); row.className = "joint-control";
        const input = document.createElement("input"); input.type="range"; input.min="-180"; input.max="180"; input.step="1"; input.value=String(Math.round(frame[side].fingers[fingerName].angles[joint]*180/Math.PI));
        const output=document.createElement("output"); output.value=input.value+'°';
        input.addEventListener("input",()=>{frame[side].fingers[fingerName].angles[joint]=Number(input.value)*Math.PI/180;output.value=input.value+'°';render(false);});
        row.append(label,input,output); box.append(row);
      }); sliders.append(box);
    }));
  };
  DATA.notes.forEach((note,index)=>{const option=document.createElement("option");option.value=String(index);option.textContent=note.solfege+' ('+note.label+') · '+note.short;select.append(option);});
  select.addEventListener("change",()=>{noteIndex=Number(select.value);frame=derivePoses(DATA.notes[noteIndex].pressed,DATA.fingerMap,DATA.keys,DATA.handGeometry);render(true);});
  document.getElementById("preset-rest").addEventListener("click",()=>{frame=derivePoses([],DATA.fingerMap,DATA.keys,DATA.handGeometry);render(true);});
  document.getElementById("preset-press").addEventListener("click",()=>{frame=derivePoses(DATA.notes[noteIndex].pressed,DATA.fingerMap,DATA.keys,DATA.handGeometry);render(true);});
  document.getElementById("copy-pose").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(document.getElementById("preview-json").textContent);}catch{}});
  render(true);
})();
</script></body></html>`;
}

function animationDataJson() {
  return JSON.stringify({
    keys,
    notes,
    chartConfigs,
    fingerMap: FINGER_MAP,
    handGeometry: HAND_GEOMETRY,
    handPoses: HAND_POSES,
    poseTable: POSE_TABLE,
  }, null, 2).replaceAll("<", "\\u003c");
}

function makeAnimationStageSvg() {
  return `<svg id="animation-stage" class="animation-stage" viewBox="0 0 900 620" role="img" aria-label="Animated saxophone fingering">
    <rect width="900" height="620" rx="0" class="anim-bg"/>
    <text x="38" y="56" class="anim-title">Saxophone Fingering Animation</text>
    <text x="38" y="84" class="anim-subtitle">손가락 이동과 키 눌림 상태</text>
    <g transform="translate(74 105) scale(1.74)" class="key-space">
      <line x1="94" y1="45" x2="94" y2="238" class="anim-body-line"/>
      <line x1="78" y1="155" x2="110" y2="155" class="anim-hand-sep"/>
      <text x="94" y="49" class="anim-hand-label">LH</text>
      <text x="94" y="160" class="anim-hand-label">RH</text>
      <g id="anim-key-layer"></g>
      <g id="anim-finger-layer"></g>
    </g>
    <g class="readout" transform="translate(520 118)">
      <rect width="322" height="306" rx="18" class="readout-panel"/>
      <text x="24" y="48" id="anim-instrument" class="readout-kicker">Alto Saxophone</text>
      <text x="24" y="96" id="anim-note" class="readout-note">Bb3 / A#3</text>
      <text x="24" y="128" id="anim-concert" class="readout-concert">실음 Db3</text>
      <text x="24" y="174" class="readout-label">Fingering</text>
      <text x="24" y="204" id="anim-formula" class="readout-formula">LH 123 + low Bb | RH 123 + low C</text>
      <text x="24" y="250" class="readout-label">Pressed keys</text>
      <text x="24" y="280" id="anim-active-count" class="readout-formula">8 keys</text>
    </g>
    <g class="mini-legend" transform="translate(520 458)">
      <circle cx="14" cy="14" r="8" class="legend-pressed"/><text x="30" y="19">눌린 키</text>
      <ellipse cx="142" cy="14" rx="15" ry="9" class="legend-finger"/><text x="166" y="19">손가락</text>
    </g>
  </svg>`;
}

function makeAnimationHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saxophone Fingering Animation / 색소폰 운지 애니메이션</title>
  <style>${animationCss()}</style>
</head>
<body>
  <main class="animation-app">
    <section class="animation-shell">
      <div class="animation-header">
        <div>
          <p>Saxophone fingering</p>
          <h1>색소폰 운지 애니메이션</h1>
        </div>
        <div class="control-cluster">
          <label>
            <span>악기</span>
            <select id="instrument-select"></select>
          </label>
          <label>
            <span>음</span>
            <select id="note-select"></select>
          </label>
        </div>
      </div>
      <div class="stage-wrap">
        ${makeAnimationStageSvg()}
      </div>
      <div class="transport">
        <button id="prev-note" type="button" aria-label="Previous note">◀</button>
        <button id="play-toggle" type="button">Play</button>
        <button id="next-note" type="button" aria-label="Next note">▶</button>
        <label class="speed-control">
          <span>속도</span>
          <input id="speed-range" type="range" min="0.5" max="2" step="0.1" value="1">
        </label>
      </div>
    </section>
  </main>
  <script>${animationRuntime()}</script>
  <script>window.initSaxAnimation({ standalone: false });</script>
</body>
</html>`;
}

function makeAnimationSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620" role="img" aria-label="Saxophone fingering animation">
  <style>${animationSvgCss()}</style>
  ${makeAnimationStageSvg()
    .replace('<svg id="animation-stage" class="animation-stage" viewBox="0 0 900 620" role="img" aria-label="Animated saxophone fingering">', '<g id="animation-stage">')
    .replace("</svg>", "</g>")}
  <script><![CDATA[
${animationRuntime()}
window.addEventListener("load", () => window.initSaxAnimation({ standalone: true }));
  ]]></script>
</svg>`;
}

function animationRuntime() {
  return `
(() => {
  const DATA = ${animationDataJson()};
  const NS = "http://www.w3.org/2000/svg";
  const noteState = {
    index: 0,
    instrument: "alto",
    timer: null,
    speed: 1,
    tween: 0,
    positions: new Map(),
  };

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }

  function centerOf(key) {
    if (key.type === "circle") return { x: key.x, y: key.y };
    return { x: key.x + key.w / 2, y: key.y + key.h / 2 };
  }

  function restPoint(key) {
    const center = centerOf(key);
    const side = center.x < 78 ? -18 : center.x > 124 ? 18 : 0;
    const vertical = center.y < 155 ? -30 : 30;
    return { x: center.x + side, y: center.y + vertical, scale: 0.82, opacity: 0.14 };
  }

  function pressPoint(key) {
    const center = centerOf(key);
    return { x: center.x, y: center.y + 1.6, scale: 1.06, opacity: 0.96 };
  }

  function pitchClassName(midi) {
    const names = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
    return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderKeys() {
    const keyLayer = document.getElementById("anim-key-layer");
    const fingerLayer = document.getElementById("anim-finger-layer");
    keyLayer.replaceChildren();
    fingerLayer.replaceChildren();

    DATA.keys.forEach((key) => {
      const keyGroup = svgEl("g", { class: "anim-key", "data-key": key.id });
      let shape;
      if (key.type === "circle") {
        shape = svgEl("circle", { cx: key.x, cy: key.y, r: key.r });
      } else {
        shape = svgEl("rect", { x: key.x, y: key.y, width: key.w, height: key.h, rx: 7 });
      }
      const labelX = key.type === "circle" ? key.x : key.x + key.w / 2;
      const labelY = key.type === "circle" ? key.y + 3 : key.y + key.h / 2 + 3;
      const label = svgEl("text", { x: labelX, y: labelY });
      label.textContent = key.label;
      keyGroup.append(shape, label);
      keyLayer.append(keyGroup);

      const center = centerOf(key);
      const rx = key.type === "circle" ? Math.max(key.r * 1.32, 8) : Math.max(key.w * 0.5, 10);
      const finger = svgEl("g", { class: "anim-finger", "data-key": key.id });
      const pad = svgEl("ellipse", { cx: 0, cy: 0, rx, ry: Math.max(rx * 0.54, 7) });
      const nail = svgEl("ellipse", { cx: rx * 0.16, cy: -1.5, rx: Math.max(rx * 0.28, 4), ry: 2.4, class: "finger-nail" });
      finger.append(pad, nail);
      fingerLayer.append(finger);
      const start = restPoint(key);
      noteState.positions.set(key.id, start);
      finger.setAttribute("transform", "translate(" + start.x + " " + start.y + ") scale(" + start.scale + ")");
      finger.style.opacity = start.opacity;
    });
  }

  function updateReadout(note) {
    const config = DATA.chartConfigs[noteState.instrument] || DATA.chartConfigs.alto;
    const concert = pitchClassName(note.midi - config.transpositionSemitones);
    setText("anim-instrument", config.englishName);
    setText("anim-note", note.label);
    setText("anim-concert", "실음 " + concert);
    setText("anim-formula", note.formula);
    setText("anim-active-count", note.pressed.length + " keys");
  }

  function setNote(nextIndex, animate = true) {
    noteState.index = (nextIndex + DATA.notes.length) % DATA.notes.length;
    const note = DATA.notes[noteState.index];
    const pressed = new Set(note.pressed);
    updateReadout(note);

    const noteSelect = document.getElementById("note-select");
    if (noteSelect) noteSelect.value = String(noteState.index);

    DATA.keys.forEach((key) => {
      const keyGroup = document.querySelector('.anim-key[data-key="' + key.id + '"]');
      if (keyGroup) keyGroup.classList.toggle("active", pressed.has(key.id));
    });

    const tweenId = ++noteState.tween;
    const started = performance.now();
    const duration = animate ? 430 : 1;
    const frames = DATA.keys.map((key) => {
      const from = noteState.positions.get(key.id) || restPoint(key);
      const to = pressed.has(key.id) ? pressPoint(key) : restPoint(key);
      return { key, from, to, el: document.querySelector('.anim-finger[data-key="' + key.id + '"]') };
    });

    function ease(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function frame(now) {
      if (tweenId !== noteState.tween) return;
      const t = Math.min(1, (now - started) / duration);
      const e = ease(t);
      frames.forEach(({ key, from, to, el }) => {
        const x = from.x + (to.x - from.x) * e;
        const y = from.y + (to.y - from.y) * e;
        const scale = from.scale + (to.scale - from.scale) * e;
        const opacity = from.opacity + (to.opacity - from.opacity) * e;
        el.setAttribute("transform", "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ") scale(" + scale.toFixed(3) + ")");
        el.style.opacity = opacity.toFixed(3);
        if (t === 1) noteState.positions.set(key.id, to);
      });
      if (t < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function stopPlayback() {
    if (noteState.timer) clearInterval(noteState.timer);
    noteState.timer = null;
    const playButton = document.getElementById("play-toggle");
    if (playButton) playButton.textContent = "Play";
  }

  function playPlayback() {
    stopPlayback();
    const playButton = document.getElementById("play-toggle");
    if (playButton) playButton.textContent = "Pause";
    const delay = Math.max(420, Math.round(1450 / noteState.speed));
    noteState.timer = setInterval(() => setNote(noteState.index + 1), delay);
  }

  function wireHtmlControls() {
    const instrumentSelect = document.getElementById("instrument-select");
    const noteSelect = document.getElementById("note-select");
    if (instrumentSelect) {
      instrumentSelect.replaceChildren();
      Object.entries(DATA.chartConfigs).forEach(([id, config]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = config.englishName.replace(" Saxophone", "");
        instrumentSelect.append(option);
      });
      instrumentSelect.value = noteState.instrument;
      instrumentSelect.addEventListener("change", () => {
        noteState.instrument = instrumentSelect.value;
        setNote(noteState.index, false);
      });
    }
    if (noteSelect) {
      noteSelect.replaceChildren();
      DATA.notes.forEach((note, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = note.label + " · " + note.short;
        noteSelect.append(option);
      });
      noteSelect.addEventListener("change", () => setNote(Number(noteSelect.value)));
    }
    document.getElementById("prev-note")?.addEventListener("click", () => setNote(noteState.index - 1));
    document.getElementById("next-note")?.addEventListener("click", () => setNote(noteState.index + 1));
    document.getElementById("play-toggle")?.addEventListener("click", () => {
      if (noteState.timer) stopPlayback();
      else playPlayback();
    });
    document.getElementById("speed-range")?.addEventListener("input", (event) => {
      noteState.speed = Number(event.target.value);
      if (noteState.timer) playPlayback();
    });
  }

  window.initSaxAnimation = function initSaxAnimation(options = {}) {
    noteState.instrument = options.instrument || "alto";
    noteState.speed = Number(document.getElementById("speed-range")?.value || 1);
    renderKeys();
    wireHtmlControls();
    setNote(0, false);
    if (options.standalone) {
      playPlayback();
      document.getElementById("animation-stage")?.addEventListener("click", () => {
        if (noteState.timer) stopPlayback();
        else playPlayback();
      });
    }
  };
})();
  `;
}

function handSvgCss() {
  return `
    .hand{pointer-events:none}
    .hand-palm,.hand-segment{fill:#f3bc98;stroke:#9a5c35;stroke-width:1.1;stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .hand-palm{filter:drop-shadow(0 1px 1px rgb(82 45 25 / 18%))}
    .hand-webbing{fill:none;stroke:#c98a5e;stroke-width:1.25;stroke-linecap:round;vector-effect:non-scaling-stroke}
    .hand-crease{fill:none;stroke:#c98a5e;stroke-width:.62;stroke-linecap:round;opacity:.82;vector-effect:non-scaling-stroke}
    .hand-nail{fill:#ffe5d0;stroke:#d89a73;stroke-width:.48;vector-effect:non-scaling-stroke}
    .finger-contact-shadow{fill:#111827;opacity:0;filter:blur(.45px)}
    .finger.is-pressed .seg-distal{filter:drop-shadow(0 .7px .35px rgb(17 24 39 / 25%))}
    .hand.is-palm-pressed .hand-palm{filter:drop-shadow(-1px 1px 1px rgb(15 118 110 / 28%))}
    .hand-contact-dot{fill:#0f766e;stroke:#fff;stroke-width:1.1;vector-effect:non-scaling-stroke}
    .hand-contact-tag{fill:#0f766e;stroke:#fff;stroke-width:.8;vector-effect:non-scaling-stroke}
    .hand-contact-label{fill:#fff;font:700 6.2px Arial,"Malgun Gothic",sans-serif;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
    @media print{
      .hand-palm,.hand-segment{fill:#f3bc98!important;filter:none!important}
      .hand-crease,.hand-webbing{stroke-width:.8}
      .finger-contact-shadow{display:none}
    }
  `;
}

function animationSvgCss() {
  return `
    ${handSvgCss()}
    .anim-bg{fill:#f8fafc}
    .anim-title{font:800 34px Arial,"Malgun Gothic",sans-serif;fill:#0f172a}
    .anim-subtitle{font:17px Arial,"Malgun Gothic",sans-serif;fill:#475569}
    .anim-body-line,.anim-hand-sep{stroke:#cbd5e1;stroke-width:2;stroke-linecap:round}
    .anim-hand-label{font:700 8px Arial,sans-serif;fill:#94a3b8;text-anchor:middle}
    .anim-key circle,.anim-key rect{fill:#fff;stroke:#64748b;stroke-width:1.5}
    .anim-key text{font:700 8px Arial,sans-serif;fill:#475569;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
    .anim-key.active circle,.anim-key.active rect{fill:#111827;stroke:#111827}
    .anim-key.active text{fill:#fff}
    .anim-finger{pointer-events:none}
    .anim-finger ellipse:first-child{fill:#f3bc98;stroke:#9a5c35;stroke-width:1.05}
    .finger-nail{fill:#ffe5d0;stroke:none}
    .readout-panel{fill:#fff;stroke:#cbd5e1;stroke-width:1.2}
    .readout-kicker{font:800 16px Arial,"Malgun Gothic",sans-serif;fill:#0f766e}
    .readout-note{font:800 38px Arial,"Malgun Gothic",sans-serif;fill:#0f172a}
    .readout-concert{font:800 18px Arial,"Malgun Gothic",sans-serif;fill:#0f766e}
    .readout-label{font:800 12px Arial,"Malgun Gothic",sans-serif;fill:#64748b}
    .readout-formula{font:700 16px Arial,"Malgun Gothic",sans-serif;fill:#1f2937}
    .mini-legend text{font:700 15px Arial,"Malgun Gothic",sans-serif;fill:#334155}
    .legend-pressed{fill:#111827}
    .legend-finger{fill:#f3bc98;stroke:#9a5c35;stroke-width:1.05}
  `;
}

function animationCss() {
  return `
    ${animationSvgCss()}
    :root{--ink:#0f172a;--muted:#475569;--line:#cbd5e1;--paper:#f8fafc;--accent:#0f766e}
    *{box-sizing:border-box}
    body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,"Malgun Gothic",sans-serif}
    .animation-app{min-height:100vh;padding:28px 18px}
    .animation-shell{max-width:1120px;margin:0 auto}
    .animation-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:14px}
    .animation-header p{margin:0 0 8px;color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:0}
    .animation-header h1{margin:0;font-size:36px;line-height:1.1}
    .control-cluster{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
    label{display:grid;gap:5px;color:#334155;font-size:12px;font-weight:800}
    select,input,button{font:700 14px Arial,"Malgun Gothic",sans-serif}
    select{height:38px;min-width:170px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 10px}
    .stage-wrap{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
    .animation-stage{display:block;width:100%;height:auto}
    .transport{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
    button{height:40px;min-width:46px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:var(--ink);cursor:pointer}
    button:hover{background:#f1f5f9}
    #play-toggle{min-width:84px;background:#111827;color:#fff;border-color:#111827}
    .speed-control{display:flex;align-items:center;gap:10px;margin-left:auto}
    .speed-control input{width:220px}
    @media (max-width:760px){
      .animation-app{padding:18px 10px}
      .animation-header{display:block}
      .control-cluster{margin-top:16px}
      select{width:100%}
      .speed-control{width:100%;margin-left:0}
      .speed-control input{width:100%}
    }
  `;
}

function sharedSvgCss() {
  return `
    .poster-title{font:800 52px Arial,"Malgun Gothic",sans-serif;fill:#0f172a}
    .poster-korean{font:700 28px Arial,"Malgun Gothic",sans-serif;fill:#334155}
    .poster-lead{font:18px Arial,"Malgun Gothic",sans-serif;fill:#475569}
    .poster-source{font:16px Arial,"Malgun Gothic",sans-serif;fill:#64748b}
    .poster-card-bg{fill:#fff;stroke:#cbd5e1;stroke-width:1.4}
    .poster-note{font:800 31px Arial,"Malgun Gothic",sans-serif;fill:#0f172a}
    .poster-sub{font:17px Arial,"Malgun Gothic",sans-serif;fill:#475569}
    .poster-formula{font:700 15px Arial,"Malgun Gothic",sans-serif;fill:#1f2937}
    .poster-foot{font:13px Arial,"Malgun Gothic",sans-serif;fill:#b45309}
    .legend-bg{fill:#e2e8f0;stroke:#cbd5e1}
    .legend-title{font:800 23px Arial,"Malgun Gothic",sans-serif;fill:#0f172a}
    .legend-text{font:16px Arial,"Malgun Gothic",sans-serif;fill:#334155}
    .legend-note{font:16px Arial,"Malgun Gothic",sans-serif;fill:#475569}
    .body-line,.hand-sep{stroke:#cbd5e1;stroke-width:2;stroke-linecap:round}
    .hand-label{font:700 8px Arial,sans-serif;fill:#94a3b8;text-anchor:middle}
    .key circle,.key rect{fill:#fff;stroke:#64748b;stroke-width:1.5}
    .key text{font:700 8px Arial,sans-serif;fill:#475569;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
    .key.active circle,.key.active rect,.sample-filled{fill:#111827;stroke:#111827}
    .key.active text{fill:#fff}
    .sample-open{fill:#fff;stroke:#64748b;stroke-width:1.5}
    .staff-line,.ledger{stroke:#334155;stroke-width:1}
    .stem{stroke:#111827;stroke-width:1.5}
    .notehead{fill:#111827}
    .accidental{font:700 18px Arial,sans-serif;fill:#111827}
  `;
}

function htmlCss() {
  return `
    ${sharedSvgCss()}
    :root{--ink:#0f172a;--muted:#475569;--line:#cbd5e1;--paper:#f8fafc;--accent:#0f766e}
    *{box-sizing:border-box}
    body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,"Malgun Gothic",sans-serif}
    main{max-width:1180px;margin:0 auto;padding:32px 18px 56px}
    .hero{display:flex;justify-content:space-between;gap:28px;align-items:flex-end;padding:22px 0 24px;border-bottom:2px solid var(--line)}
    .eyebrow{margin:0 0 8px;color:var(--accent);font-weight:800;letter-spacing:.04em;text-transform:uppercase}
    h1{margin:0;font-size:42px;line-height:1.05}
    .subtitle{max-width:760px;margin:12px 0 0;font-size:17px;line-height:1.55;color:var(--muted)}
    .legend-box{width:340px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-size:14px;color:#334155}
    .legend-box>div{display:inline-flex;align-items:center;margin:0 12px 8px 0;gap:6px;font-weight:700}
    .legend-box p{margin:4px 0 0;line-height:1.45}
    .dot{display:inline-block;width:16px;height:16px;border-radius:50%;border:1.5px solid #64748b}
    .dot.filled{background:#111827;border-color:#111827}
    .pill{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:18px;border-radius:9px;background:#111827;color:#fff;font-weight:800;font-size:11px}
    .sheet{margin-top:26px;padding:20px;background:#fff;border:1px solid var(--line);border-radius:12px}
    .sheet-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px}
    .sheet h2{margin:0;font-size:23px}
    .sheet-head p{margin:4px 0 0;color:var(--muted)}
    .sheet-mark{font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase}
    .card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .card{border:1px solid #dbe3ef;border-radius:10px;padding:10px;min-height:206px;display:flex;flex-direction:column}
    .card header{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}
    .card h3{margin:0;font-size:21px;line-height:1}
    .card header p{margin:4px 0 0;color:var(--muted);font-size:12px;font-weight:700}
    .concert{font-size:12px;color:#0f766e;font-weight:800;white-space:nowrap}
    .visuals{display:grid;grid-template-columns:1fr 116px;align-items:center;gap:8px;min-height:116px}
    .staff{width:100%;height:auto}
    .diagram{width:112px;height:auto}
    .formula{margin-top:auto;font-size:12px;font-weight:800;color:#1f2937;line-height:1.3}
    .note{margin-top:3px;font-size:11px;color:#b45309;font-weight:700}
    .sources{margin:28px 0 0;padding:18px 20px;background:#fff;border:1px solid var(--line);border-radius:12px}
    .sources h2{font-size:20px;margin:0 0 8px}
    .sources p{margin:0 0 8px;color:var(--muted)}
    .sources ul{margin:0;padding-left:19px;line-height:1.55}
    .sources a{color:#0f766e}
    @media (max-width:850px){
      .hero{display:block}.legend-box{width:auto;margin-top:18px}.card-grid{grid-template-columns:1fr}.card{min-height:0}
    }
    @page{size:A4 landscape;margin:8mm}
    @media print{
      body{background:#fff}
      main{max-width:none;padding:0}
      .hero,.sources{break-after:page;margin:0;border-radius:0;border:0}
      .sheet{break-after:page;margin:0;border:0;border-radius:0;padding:0;background:#fff}
      .sheet:last-of-type{break-after:auto}
      .sheet-head{margin-bottom:5px;padding-bottom:5px}
      .sheet h2{font-size:18px}
      .sheet-head p,.sheet-mark{font-size:10px}
      .card-grid{grid-template-columns:repeat(3,1fr);gap:5px}
      .card{min-height:42mm;padding:5px;border-color:#cbd5e1;break-inside:avoid}
      .card h3{font-size:15px}
      .card header{margin-bottom:2px}
      .card header p,.concert{font-size:9px}
      .visuals{grid-template-columns:1fr 25mm;gap:2px;min-height:24mm}
      .diagram{width:24mm}
      .formula{font-size:8.5px}
      .note{font-size:8px}
    }
  `;
}

async function main() {
  const missingFingerMappings = keys.filter((key) => !FINGER_MAP[key.id]).map((key) => key.id);
  if (missingFingerMappings.length) {
    throw new Error(`FINGER_MAP 누락: ${missingFingerMappings.join(", ")}`);
  }
  if (Object.keys(FINGER_MAP).length !== keys.length) {
    throw new Error(`FINGER_MAP 개수 불일치: keys=${keys.length}, map=${Object.keys(FINGER_MAP).length}`);
  }
  const poseErrors = validatePoseTable(keys, FINGER_MAP, HAND_GEOMETRY);
  if (poseErrors.length) {
    console.table(poseErrors);
    throw new Error(`손끝-키 접점 오차가 1.5를 넘는 키가 ${poseErrors.length}개입니다.`);
  }
  writeFileSync(svgPath, makePosterSvg(), "utf8");
  writeFileSync(htmlPath, makeHtml(), "utf8");
  writeFileSync(animationHtmlPath, makeAnimationHtml(), "utf8");
  writeFileSync(animationSvgPath, makeAnimationSvg(), "utf8");
  writeFileSync(handPreviewPath, makeHandPreviewHtml(), "utf8");

  if (!skipPdf) {
    const chromium = loadChromium();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
    });
    await browser.close();
  }

  const outputs = [svgPath, htmlPath, ...(skipPdf ? [] : [pdfPath]), animationHtmlPath, animationSvgPath, handPreviewPath];
  console.log(`Wrote:\n- ${outputs.join("\n- ")}${skipPdf ? "\n(PDF skipped with --no-pdf)" : ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
