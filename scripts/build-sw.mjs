// Runs after `next build`: bundles the service worker into out/sw.js with a precache list of
// everything the Studio needs offline (pages, hashed Next.js chunks, the analysis worker, the
// model and the WebAssembly runtime) and a cache version derived from their contents, so every
// deploy that changes any of them installs a fresh cache.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "out");
if (!existsSync(out)) throw new Error("out/ not found: run next build first");
const runtime = JSON.parse(readFileSync(join(root, "src", "generated-runtime.json"), "utf8"));
const card = JSON.parse(readFileSync(join(root, "src", "data", "model-card.json"), "utf8"));

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const url = (file) => "/" + relative(out, file).split(sep).join("/");

const files = [
  ...walk(join(out, "_next", "static")),
  ...walk(join(out, "samples")),
  ...walk(join(out, "images")),
  ...walk(join(out, "fonts")),
  ...["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"].map((f) => join(out, "ort", runtime.ort, f)),
  join(out, "models", "karyon-nuclei-v1.onnx"),
  join(out, "engine", "worker.js"),
  join(out, "icon.svg"),
];
const pages = { "/": "index.html", "/studio": "studio.html", "/model": "model.html" };
const hash = createHash("sha256");
for (const f of [...files, ...Object.values(pages).map((p) => join(out, p))]) hash.update(url(f)).update(readFileSync(f));
const version = hash.digest("hex").slice(0, 16);

const sha = (card.export?.sha256 || runtime.app).slice(0, 12);
const precache = [
  ...Object.keys(pages),
  ...files.map(url).map((u) => (u === "/models/karyon-nuclei-v1.onnx" ? `${u}?v=${sha}` : u === "/engine/worker.js" ? `${u}?v=${runtime.app}` : u)),
];

await build({
  entryPoints: [join(root, "src", "worker", "sw.ts")],
  outfile: join(out, "sw.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  define: { __CACHE_VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(precache) },
});
console.log(`build-sw: out/sw.js, cache ${version}, ${precache.length} precached URLs`);
