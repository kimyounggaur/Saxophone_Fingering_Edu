// Render notes from a SaxSynth engine bundle (v2 or v3) offline in headless Chromium
// and save them as float32 mono WAV files so analyze_ref.py can measure them.
//
// needs `esbuild` and `playwright` (not repo dependencies): npm i --no-save esbuild playwright && npx playwright install chromium
// (they are loaded through createRequire so that a globally installed playwright, e.g. via NODE_PATH, also works)
//
// usage: node render-engine.mjs <v2|v3> <instrument> <midiLo> <midiHi> <outDir> [duration=1.42] [intensity=0.72] [extraJson]
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const nodeRequire = createRequire(import.meta.url)
const esbuild = nodeRequire("esbuild")
const { chromium } = nodeRequire("playwright")

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const SR = 44100

function wavF32(samples, sr) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write("RIFF", 0)
  buf.writeUInt32LE(36 + n * 4, 4)
  buf.write("WAVEfmt ", 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20) // IEEE float
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(32, 34)
  buf.write("data", 36)
  buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i += 1) buf.writeFloatLE(samples[i], 44 + i * 4)
  return buf
}

async function main() {
  const [version, instrument, lo, hi, outDir, durArg, intArg, extraArg] = process.argv.slice(2)
  const duration = Number(durArg ?? 1.42)
  const intensity = Number(intArg ?? 0.72)
  const extra = extraArg ? JSON.parse(extraArg) : {}
  const entry = path.join(REPO, "lib/sax-synth.ts")
  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    globalName: "SaxLib",
    platform: "browser",
    target: "es2022",
    write: false,
  })
  const code = built.outputFiles[0].text
  fs.mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] })
  const page = await browser.newPage()
  await page.setContent("<!doctype html><html><body>sax render</body></html>")
  await page.addScriptTag({ content: code })

  for (let midi = Number(lo); midi <= Number(hi); midi += 1) {
    const b64 = await page.evaluate(
      async ({ midi, instrument, duration, intensity, sr, version, extra }) => {
        // 0.3 s of lead-in lets the master-volume smoothing settle before the note starts (as in the app)
        const lead = 0.3
        const length = Math.ceil(sr * (duration + 1.0 + lead))
        const ctx = new OfflineAudioContext(2, length, sr)
        const engine = new SaxLib.SaxSynthEngine(ctx, version === "v3" ? { mode: "model" } : {})
        engine.setVolume(0.6)
        ctx.suspend(lead).then(() => {
          engine.play({ midi, instrument, duration, intensity, ...extra })
          ctx.resume()
        })
        const rendered = await ctx.startRendering()
        const a = rendered.getChannelData(0)
        const b = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : a
        const skip = Math.round(lead * sr)
        const mono = new Float32Array(a.length - skip)
        for (let i = 0; i < mono.length; i += 1) mono[i] = 0.5 * (a[i + skip] + b[i + skip])
        const bytes = new Uint8Array(mono.buffer)
        let s = ""
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        return btoa(s)
      },
      { midi, instrument, duration, intensity, sr: SR, version, extra },
    )
    const bytes = Buffer.from(b64, "base64")
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
    fs.writeFileSync(path.join(outDir, `${midi}.wav`), wavF32(samples, SR))
  }
  await browser.close()
  console.log(`${version} ${instrument}: rendered ${Number(hi) - Number(lo) + 1} notes -> ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
