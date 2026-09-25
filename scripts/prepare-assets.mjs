// Copies the onnxruntime-web runtime into public/ort and bundles the analysis
// worker into public/engine/worker.js. Runs before `next dev` and `next build`.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");
const ortPkg = JSON.parse(readFileSync(join(root, "node_modules", "onnxruntime-web", "package.json"), "utf8"));
const ortOut = join(root, "public", "ort", ortPkg.version);
mkdirSync(ortOut, { recursive: true });

const files = [
  "ort.wasm.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort.webgpu.min.mjs",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];
for (const f of files) {
  const src = join(ortDist, f);
  if (!existsSync(src)) throw new Error(`onnxruntime-web file missing: ${f}`);
  copyFileSync(src, join(ortOut, f));
}

// self-hosted fonts (SIL Open Font License), served from our own origin and preloaded
mkdirSync(join(root, "public", "fonts"), { recursive: true });
for (const [pkgName, file] of [
  ["inter", "inter-latin-wght-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2"],
]) {
  copyFileSync(join(root, "node_modules", "@fontsource-variable", pkgName, "files", file), join(root, "public", "fonts", file));
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
await build({
  entryPoints: [join(root, "src", "worker", "engine.worker.ts")],
  outfile: join(root, "public", "engine", "worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});
writeFileSync(join(root, "src", "generated-runtime.json"), JSON.stringify({ app: pkg.version, ort: ortPkg.version }, null, 2) + "\n");
console.log(`prepare-assets: ort runtime (${files.length} files) + analysis worker ready`);
