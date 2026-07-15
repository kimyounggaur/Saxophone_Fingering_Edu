import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = path.join(repoRoot, "dist");
const outputRoot = path.join(repoRoot, ".vercel", "output");
const functionRoot = path.join(outputRoot, "functions", "index.func");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(functionRoot, { recursive: true });

await cp(path.join(distRoot, "client"), path.join(outputRoot, "static"), {
  recursive: true,
});
await cp(path.join(distRoot, "client"), path.join(functionRoot, "static"), {
  recursive: true,
});
await cp(path.join(distRoot, "server"), path.join(functionRoot, "server"), {
  recursive: true,
});

await writeFile(
  path.join(outputRoot, "config.json"),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index" },
      ],
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(functionRoot, ".vc-config.json"),
  `${JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.cjs",
      launcherType: "Nodejs",
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(functionRoot, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);

await writeFile(
  path.join(functionRoot, "index.cjs"),
  `const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");

const staticRoot = path.join(__dirname, "static");
const serverEntry = path.join(__dirname, "server", "index.js");
let workerPromise;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

function loadWorker() {
  workerPromise ??= import(pathToFileURL(serverEntry).href).then((module) => module.default);
  return workerPromise;
}

function assetResponse(status, body = "Not found", headers = {}) {
  return new Response(body, { status, headers });
}

async function fetchAsset(request) {
  const url = new URL(request.url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return assetResponse(400, "Bad Request");
  }

  const relativePath = pathname.replace(/^\\/+/, "") || "index.html";
  if (relativePath.includes("\\0")) return assetResponse(400, "Bad Request");

  const root = path.resolve(staticRoot);
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return assetResponse(403, "Forbidden");
  }

  try {
    const body = await fs.readFile(filePath);
    return new Response(body, {
      headers: {
        "content-type": mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      },
    });
  } catch {
    return assetResponse(404);
  }
}

function incomingRequestToFetchRequest(req) {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const protocol = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim();
  const url = new URL(req.url || "/", \`\${protocol}://\${host}\`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }

  const method = req.method || "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie" && setCookie.length > 0) return;
    res.setHeader(key, value);
  });
  if (setCookie.length > 0) res.setHeader("set-cookie", setCookie);

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

module.exports = async function handler(req, res) {
  try {
    const worker = await loadWorker();
    const request = incomingRequestToFetchRequest(req);
    const response = await worker.fetch(
      request,
      { ASSETS: { fetch: fetchAsset } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
};
`,
);

console.log("Generated .vercel/output for SaxHands.");
