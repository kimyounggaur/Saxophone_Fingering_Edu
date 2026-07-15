import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = new URL("../public/favicon.svg", import.meta.url);
const targets = [
  [192, new URL("../public/icon-192.png", import.meta.url)],
  [512, new URL("../public/icon-512.png", import.meta.url)],
  [180, new URL("../public/apple-touch-icon.png", import.meta.url)],
];

await Promise.all(
  targets.map(([size, target]) =>
    sharp(fileURLToPath(source))
      .resize(size, size)
      .png({ compressionLevel: 9, palette: true })
      .toFile(fileURLToPath(target)),
  ),
);

console.log("[brand-assets] generated 192px, 512px, and 180px PNG icons");
