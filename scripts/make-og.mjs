// Renders public/og.png (1200 x 630) from the hero figures with a headless browser.
// Usage: node scripts/make-og.mjs   (set PW_CHROMIUM_PATH to use a preinstalled Chromium)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const b64 = (p) => readFileSync(join(root, p)).toString("base64");
const font = b64("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
const hero = b64("public/images/hero-input.jpg");
const overlay = b64("public/images/hero-overlay.png");
const icon = readFileSync(join(root, "public/icon.svg"), "utf8").replace("<svg ", '<svg width="44" height="44" ');
const card = JSON.parse(readFileSync(join(root, "src/data/model-card.json"), "utf8"));
const pq = (card.test.karyon.all.pq * 100).toFixed(1);

const html = `<!doctype html><html><head><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; font-family: Inter; background: #0b0c11; color: #ecedf3; display: flex; overflow: hidden; }
.l { flex: 1; padding: 64px 56px; display: flex; flex-direction: column; justify-content: space-between; }
.logo { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
.mark { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #5a59e6, #d9468f); }
h1 { font-size: 62px; line-height: 1.02; letter-spacing: -0.035em; font-weight: 650; }
h1 span { background: linear-gradient(90deg, #8b8aff, #f472b6); -webkit-background-clip: text; color: transparent; }
p { color: #a1a4b5; font-size: 22px; line-height: 1.45; margin-top: 18px; max-width: 520px; }
.stats { display: flex; gap: 36px; font-size: 16px; color: #8a8da0; }
.stats b { display: block; color: #ecedf3; font-size: 28px; font-weight: 600; margin-top: 4px; }
.r { width: 520px; height: 630px; position: relative; }
.r img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.r .ov { clip-path: inset(0 0 0 42%); image-rendering: pixelated; }
.r .base2 { clip-path: inset(0 0 0 42%); }
.r .line { position: absolute; top: 0; bottom: 0; left: 42%; width: 3px; background: white; box-shadow: 0 0 16px rgba(0,0,0,.6); }
</style></head><body>
<div class="l">
  <div class="logo">${icon}Karyon</div>
  <div><h1>Every nucleus, measured.<br/><span>Nothing uploaded.</span></h1>
  <p>Nucleus segmentation, Ki-67 scoring and QuPath export that run entirely in the browser.</p></div>
  <div class="stats"><div>Test PQ<b>${pq}</b></div><div>Model<b>${(card.model.onnx_bytes / 1e6).toFixed(1)} MB</b></div><div>Uploads<b>0 bytes</b></div></div>
</div>
<div class="r"><img src="data:image/jpeg;base64,${hero}"/><img class="base2" src="data:image/jpeg;base64,${hero}"/><img class="ov" src="data:image/png;base64,${overlay}"/><div class="line"></div></div>
</body></html>`;

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: join(root, "public", "og.png") });
await browser.close();
console.log("wrote public/og.png");
