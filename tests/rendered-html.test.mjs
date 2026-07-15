import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`https://saxhands.example${path}`, {
      headers: {
        accept: "text/html",
        host: "saxhands.example",
        "x-forwarded-host": "saxhands.example",
        "x-forwarded-proto": "https",
      },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete Korean learning app and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"/i);
  assert.match(html, /<title>SaxHands[^<]*색소폰 운지법 배우기<\/title>/i);
  assert.match(html, /두 손으로 익히는 색소폰 운지/);
  assert.match(html, /빠르게 찾기/);
  assert.match(html, /탐색/);
  assert.match(html, /배우기/);
  assert.match(html, /연습/);
  assert.match(html, /운지표/);
  assert.match(html, /sax-stage__svg/);
  assert.match(html, /property="og:image" content="https:\/\/saxhands\.example\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/i);
  assert.doesNotMatch(html, /Your site is taking shape|Codex is working|react-loading-skeleton/i);
});

test("keeps the canonical fingering source coherent", async () => {
  const { SOURCE_DATA } = await import("../lib/generated/source-data.ts");
  assert.equal(SOURCE_DATA.keys.length, 23);
  assert.equal(SOURCE_DATA.notes.length, 33);
  assert.deepEqual(SOURCE_DATA.notes.map((note) => note.midi), Array.from({ length: 33 }, (_, index) => 58 + index));
  assert.equal(SOURCE_DATA.chartConfigs.alto.transpositionSemitones, 9);
  assert.equal(SOURCE_DATA.chartConfigs.tenor.transpositionSemitones, 14);
  assert.equal(SOURCE_DATA.chartConfigs.soprano.transpositionSemitones, 2);

  const checked = spawnSync(process.execPath, ["scripts/extract-source-data.mjs", "--check"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /23 keys, 33 notes, MIDI 58\.\.90/);
});

test("ships installable and offline-safe public assets", async () => {
  const publicRoot = new URL("../public/", import.meta.url);
  const [manifestText, serviceWorkerText, offlineText, og, icon192, icon512, apple] = await Promise.all([
    readFile(new URL("manifest.webmanifest", publicRoot), "utf8"),
    readFile(new URL("sw.js", publicRoot), "utf8"),
    readFile(new URL("offline.html", publicRoot), "utf8"),
    stat(new URL("og.png", publicRoot)),
    stat(new URL("icon-192.png", publicRoot)),
    stat(new URL("icon-512.png", publicRoot)),
    stat(new URL("apple-touch-icon.png", publicRoot)),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ko");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.match(serviceWorkerText, /offline\.html/);
  assert.match(serviceWorkerText, /caches\.match/);
  assert.match(serviceWorkerText, /SKIP_WAITING/);
  const installHandler = serviceWorkerText.match(/addEventListener\("install"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.doesNotMatch(installHandler, /skipWaiting/);
  assert.match(offlineText, /다시 열기/);
  assert.ok(og.size > 100_000 && og.size < 5_000_000);
  assert.ok(icon192.size > 1_000 && icon512.size > icon192.size && apple.size > 1_000);
  await access(new URL("favicon.svg", publicRoot));
});
