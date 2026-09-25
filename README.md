# Karyon

**Nucleus-level computational pathology that runs entirely in the browser.**

Karyon segments, counts and measures every nucleus in H&E and IHC images, scores Ki-67 style DAB positivity and exports QuPath-ready results. The PyTorch model is exported to ONNX and executed client-side with onnxruntime-web (WebGPU when available, multi-threaded WebAssembly otherwise). No image ever leaves the device, which is enforced by the browser through a strict Content Security Policy.

| | |
|---|---|
| Model | `karyon-nuclei-v1`, 0.92 M parameter multi-head U-Net, 3.7 MB ONNX |
| Heads | nucleus foreground, instance contour, normalised distance map |
| Instances | marker-controlled watershed, bit-exact between Python and TypeScript |
| Analyses | counts, density, area, perimeter, circularity, solidity, eccentricity, H/E/DAB optical density, positive index, H-score |
| IHC scoring | DAB score = nuclear minus perinuclear DAB, so membranous staining does not inflate the index (Ki-67 index error 3.0 pp vs 10.6 pp for mean DAB) |
| Stain tools | Ruifrok colour deconvolution, Macenko normalisation, automatic H&E vs H-DAB detection, segmentation-guided counterstain estimation |
| Exports | per-nucleus CSV, QuPath GeoJSON detections, JSON run report, overlay PNG |
| Deployment | fully static Next.js export, ready for Vercel, works offline after the first visit (service worker) |
| Quality | 31 Vitest + 13 pytest unit tests incl. bit-exact Python/TypeScript parity, 22 Playwright e2e runs (desktop + mobile) with axe WCAG 2 AA checks, Lighthouse 100 accessibility / best practices / SEO |

> Research use only. Karyon is not a medical device and must not be used for diagnosis or treatment decisions.

## Repository layout

```
.
├── src/
│   ├── app/                  Next.js App Router pages (landing, /studio, /model)
│   ├── components/           UI, including the canvas slide viewer
│   ├── hooks/useEngine.ts    worker lifecycle and request multiplexing
│   ├── lib/pathology/        image processing core (TypeScript)
│   │   ├── postprocess.ts    watershed instance extraction (twin of the Python reference)
│   │   ├── stain.ts          deconvolution, Macenko, stain detection
│   │   ├── tiling.ts         sliding-window inference with cosine blending
│   │   ├── features.ts       morphometry and boundary tracing
│   │   ├── classical.ts      Otsu + watershed baseline engine
│   │   └── export.ts         CSV, GeoJSON, report
│   └── worker/engine.worker.ts   the analysis pipeline, off the main thread
├── public/models/            the shipped ONNX model
├── ml/                       PyTorch training, evaluation and export (see ml/README.md)
├── tests/unit/               Vitest, including Python/TypeScript parity fixtures
├── e2e/                      Playwright end-to-end and axe accessibility tests
├── scripts/                  asset preparation and a production-equivalent static server
└── vercel.json               security headers (COOP/COEP/CSP) and caching
```

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` and `npm run build` first run `scripts/prepare-assets.mjs`, which copies the onnxruntime-web runtime into `public/ort/<version>/`, copies the self-hosted fonts into `public/fonts/` and bundles the analysis worker into `public/engine/worker.js` with esbuild. After `next build`, `scripts/build-sw.mjs` writes `out/sw.js` with a content-hashed precache list for offline use. All of these are generated and git-ignored.

### Production build

```bash
npm run build        # static export into out/
npm start            # serves out/ with the exact headers from vercel.json
```

### Quality gates

```bash
npm run check        # tsc --noEmit, eslint, vitest
npm run test:e2e     # Playwright + axe (set PW_CHROMIUM_PATH to use a preinstalled Chromium)
cd ml && pytest -q   # Python unit tests, ONNX parity
```

## Deploying to Vercel

1. Push the repository to GitHub, GitLab or Bitbucket.
2. Import it in Vercel. The framework preset is detected as Next.js; no settings need to change.
3. Optionally set `NEXT_PUBLIC_SITE_URL` (canonical URL for metadata and the sitemap) and `NEXT_PUBLIC_CONTACT_EMAIL` (enables the contact buttons on the plans section).

Or from the CLI: `npx vercel --prod`.

`vercel.json` sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` so the page is cross-origin isolated (required for multi-threaded WebAssembly), a Content Security Policy whose `connect-src 'self'` makes exfiltration of images impossible, and immutable caching for the versioned runtime and model files.

## How the pipeline works

1. **Decode** PNG, JPEG, WebP, BMP or TIFF in the browser (TIFF via UTIF).
2. **Resample** to the model's 0.5 µm per pixel working resolution using the scan resolution the user selects.
3. **Stain analysis**: automatic H&E vs H-DAB detection, optional Macenko normalisation.
4. **Inference**: 256 px tiles, 32 px overlap, raised-cosine blending, onnxruntime-web in a Web Worker.
5. **Instances**: foreground threshold, markers from the distance head gated by the contour head, bucketed priority-flood watershed.
6. **Measurement**: morphometry from moments and Vossepoel-Smeulders chain-code perimeters; stain optical density from colour deconvolution; DAB score from the nuclear versus perinuclear (4 px ring) concentration; exact pixel-edge outlines for export.

## Model

See the [model card](src/app/model/page.tsx) (rendered at `/model`) for architecture, training data, metrics, calibration and limitations. Version 1 is trained on a physics-based synthetic generator because public annotated datasets were not reachable from the build environment; `ml/` contains a drop-in loader to fine-tune on real annotated data.

## Business case

See [docs/VENTURE.md](docs/VENTURE.md) for the market, business model, moat and five adjacent products that reuse the same engine.

## License

Apache-2.0. Sample `real-ihc-colon.jpg` is from the scikit-image sample data (no known copyright restrictions). Inter and JetBrains Mono are used under the SIL Open Font License.
