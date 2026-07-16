import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "public", "site");
const files = [
  "index.html",
  "hand-preview.html",
  "sax-fingering-animation.html",
  "sax-fingering-animation.svg",
  "alto-sax-fingering-chart.html",
  "alto-sax-fingering-chart.svg",
  "alto-sax-fingering-chart.pdf",
  "tenor-sax-fingering-chart.html",
  "tenor-sax-fingering-chart.svg",
  "tenor-sax-fingering-chart.pdf",
  "soprano-sax-fingering-chart.html",
  "soprano-sax-fingering-chart.svg",
  "soprano-sax-fingering-chart.pdf"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map((file) => cp(resolve(root, file), resolve(output, file))));
