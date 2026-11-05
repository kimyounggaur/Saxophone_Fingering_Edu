// Render notes straight from lib/sax-model.ts in Node (no browser) and save float32 WAVs.
// usage: node render-model.mjs <instrument> <lo> <hi> <outDir> [duration=1.42] [intensity=0.72] [controlsJson={}] [seed=0]
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const { renderSaxTone } = await import(pathToFileURL(path.join(REPO, "lib/sax-model.ts")).href)
const [instrument, lo, hi, outDir, durArg, intArg, ctlArg, seedArg] = process.argv.slice(2)
const SR = 44100
function wavF32(samples, sr) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34)
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i += 1) buf.writeFloatLE(samples[i], 44 + i * 4)
  return buf
}
fs.mkdirSync(outDir, { recursive: true })
const duration = Number(durArg ?? 1.42)
const intensity = Number(intArg ?? 0.72)
const controls = ctlArg ? JSON.parse(ctlArg) : {}
const seed = Number(seedArg ?? 0)
let totalMs = 0
for (let midi = Number(lo); midi <= Number(hi); midi += 1) {
  const t0 = performance.now()
  const { samples } = renderSaxTone({ midi, instrument, duration, intensity, sampleRate: SR, seed, controls })
  totalMs += performance.now() - t0
  // pad with 1 s of silence so the analysis windows exist like the engine renders
  const padded = new Float32Array(samples.length + SR)
  padded.set(samples)
  fs.writeFileSync(path.join(outDir, `${midi}.wav`), wavF32(padded, SR))
}
console.log(`v3 model ${instrument} ${lo}-${hi}: ${(totalMs / (Number(hi) - Number(lo) + 1)).toFixed(1)} ms/note render time -> ${outDir}`)
