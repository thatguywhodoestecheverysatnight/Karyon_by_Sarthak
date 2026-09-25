// Minimal static server for `out/` that applies the same headers as vercel.json
// (COOP/COEP, CSP, caching) so local and e2e runs behave exactly like production.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "out");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};
const rules = vercel.headers.map((h) => ({ re: new RegExp("^" + h.source.replace("(.*)", "(.*)") + "$"), headers: h.headers }));

function resolve(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(root, clean), join(root, clean + ".html"), join(root, clean, "index.html")];
  return candidates.find((p) => existsSync(p) && statSync(p).isFile());
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  for (const r of rules) if (r.re.test(url.pathname)) for (const h of r.headers) res.setHeader(h.key, h.value);
  let file = resolve(url.pathname);
  let status = 200;
  if (!file) {
    file = join(root, "404.html");
    status = 404;
  }
  const type = types[extname(file)] || "application/octet-stream";
  // compress text and wasm like Vercel's edge does, so local measurements are representative
  const compressible = /text|javascript|json|xml|svg|wasm/.test(type);
  if (compressible && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    res.writeHead(status, { "Content-Type": type, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res);
  } else {
    res.writeHead(status, { "Content-Type": type });
    createReadStream(file).pipe(res);
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
