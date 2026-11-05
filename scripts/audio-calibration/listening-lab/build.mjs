// Builds the listening lab into one self-contained HTML page.
//
//   node scripts/audio-calibration/listening-lab/build.mjs <outDir>
//
// Writes <outDir>/sax-lab.html (page fragment: title, style, markup and script, ready to publish as an
// artifact) and <outDir>/sax-lab-standalone.html (the same inside a complete HTML document).
// esbuild is already in node_modules as a dependency of the toolchain; nothing is installed.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const esbuild = nodeRequire("esbuild");

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node build.mjs <outDir>");
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(here, "src/main.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  legalComments: "none",
  write: false,
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = fs.readFileSync(path.join(here, "template.html"), "utf8");
if (!template.includes("/*__BUNDLE__*/")) throw new Error("template.html lost its bundle marker");
const fragment = template.replace("/*__BUNDLE__*/", () => script);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "sax-lab.html"), fragment);

// The publisher wraps the fragment in a skeleton with this reset; the standalone copy mirrors it.
const standalone = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px system-ui,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
</head>
<body>
${fragment}
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, "sax-lab-standalone.html"), standalone);
console.log(`built ${path.join(outDir, "sax-lab.html")} (${(fragment.length / 1024).toFixed(0)} KB)`);
