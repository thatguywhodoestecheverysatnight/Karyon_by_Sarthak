import Link from "next/link";
import { ArrowRight, Boxes, Cpu, FileOutput, Gauge, Layers, Lock, Microscope, ScanLine, ShieldCheck, Sparkles } from "lucide-react";
import card from "@/data/model-card.json";
import { SiteFooter, SiteHeader } from "@/components/brand";
import { CompareSlider } from "@/components/CompareSlider";

const pct = (v: number) => `${(v * 100).toFixed(1)}`;
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function Home() {
  const k = card.test.karyon.all;
  const c = card.test.classical.all;
  const mb = (card.model.onnx_bytes / 1e6).toFixed(1);
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* ------------------------------------------------------------ hero */}
        <section className="relative overflow-hidden">
          <div className="grid-bg pointer-events-none absolute inset-0 -z-10" aria-hidden />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted shadow-card">
                <span className="size-1.5 rounded-full bg-ok" aria-hidden /> Computational pathology, on device
              </p>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-[3.6rem]">
                Every nucleus, measured.
                <br />
                <span className="bg-gradient-to-r from-[#5a59e6] to-[#d9468f] bg-clip-text text-transparent">Nothing uploaded.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                Karyon segments nuclei in H&amp;E and IHC images, scores Ki-67 and exports QuPath-ready results. The neural network runs inside the browser on WebGPU or WebAssembly, so images stay on the machine they are viewed on.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/studio" className="inline-flex items-center gap-2 rounded-xl bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90">
                  Open the Studio <ArrowRight className="size-4" />
                </Link>
                <Link href="/studio?sample=ihc-ki67-high" className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold transition hover:border-border-strong">
                  Try a Ki-67 sample
                </Link>
              </div>
              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6">
                <div>
                  <dt className="text-xs text-faint">Uploaded to a server</dt>
                  <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">0 bytes</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Model download</dt>
                  <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{mb} MB</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Per 256 px tile, 2 CPU cores</dt>
                  <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{card.latency_ms_256_cpu2} ms</dd>
                </div>
              </dl>
            </div>
            <div className="space-y-3">
              <CompareSlider base="/images/hero-input.jpg" overlay="/images/hero-overlay.png" alt="H&E carcinoma tile with every nucleus outlined by Karyon" width={512} height={512} />
              <p className="text-center text-xs text-faint">Drag to compare. Output of the shipped model on an unseen tile, no manual correction.</p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ metrics */}
        <section aria-labelledby="bench" className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="bench" className="text-sm font-semibold uppercase tracking-[0.1em] text-faint">Held-out benchmark</h2>
                <p className="mt-1 text-sm text-muted">{card.test.n_tiles} unseen tiles, H&amp;E and IHC. Instance metrics, higher is better.</p>
              </div>
              <Link href="/model" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                Full model card <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
              {[
                ["Panoptic quality", k.pq, c.pq],
                ["Aggregated Jaccard", k.aji, c.aji],
                ["Detection F1", k.f1_det, c.f1_det],
                ["Pixel Dice", k.dice, c.dice],
              ].map(([label, a, b]) => (
                <div key={label as string}>
                  <p className="text-sm text-muted">{label}</p>
                  <p className="tabular mt-1 text-4xl font-semibold tracking-tight">{pct(a as number)}</p>
                  <p className="tabular mt-1 text-xs text-faint">classical baseline {pct(b as number)}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-faint">Benchmark tiles are synthetic with exact ground truth. Real-world accuracy depends on the lab, scanner and tissue; see the limitations on the model card.</p>
          </div>
        </section>

        {/* ------------------------------------------------------------ how */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-accent">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">A full pathology pipeline in a browser tab</h2>
            <p className="mt-4 text-muted">
              A compact U-Net predicts three maps for every pixel. Together they let a watershed split nuclei that touch, which is where simple thresholding fails.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {[
              { t: "Input tile", d: "Any H&E or IHC image. Resampled to 0.5 µm per pixel and optionally stain-normalised.", img: "/images/heads-input.png" },
              { t: "Foreground", d: "Probability that a pixel belongs to any nucleus.", img: "/images/heads-fg.png" },
              { t: "Contour", d: "Nuclear boundaries, including the seam between touching nuclei.", img: "/images/heads-contour.png" },
              { t: "Distance", d: "Distance to the boundary. Its peaks seed one watershed marker per nucleus.", img: "/images/heads-dist.png" },
            ].map((s, i) => (
              <figure key={s.t} className="overflow-hidden rounded-2xl border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.img} alt={`${s.t} map produced by the model`} width={256} height={256} className="aspect-square w-full bg-viewer object-cover" loading="lazy" />
                <figcaption className="p-4">
                  <p className="font-mono text-[11px] text-faint">0{i + 1}</p>
                  <p className="mt-1 font-medium">{s.t}</p>
                  <p className="mt-1 text-sm text-muted">{s.d}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------ features */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Built for the measurements pathologists actually report</h2>
            <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { i: ScanLine, t: "Instance segmentation", d: "Separate outlines for every nucleus, including dense clusters, with area, perimeter, circularity, solidity and eccentricity." },
                { i: Gauge, t: "Ki-67 and DAB scoring", d: "Positive index and H-score from nuclear versus perinuclear DAB, so membranous staining does not inflate counts. Move the threshold and every call updates instantly." },
                { i: Layers, t: "Stain separation", d: "Ruifrok colour deconvolution into hematoxylin, eosin or DAB channels, and Macenko normalisation for H&E." },
                { i: FileOutput, t: "QuPath and CSV export", d: "GeoJSON detections open directly in QuPath. Per-nucleus CSV and a JSON run report for audit trails." },
                { i: Cpu, t: "WebGPU, with a fallback", d: "Uses the GPU when the browser exposes WebGPU and multi-threaded WebAssembly everywhere else." },
                { i: Microscope, t: "Honest baseline included", d: "A classical Otsu and watershed engine runs side by side, so you can see what the network adds on your own images." },
              ].map(({ i: Icon, t, d }) => (
                <div key={t}>
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-4 font-semibold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ privacy */}
        <section id="privacy" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-accent">Privacy architecture</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Private by construction, not by policy</h2>
            <p className="mt-4 leading-relaxed text-muted">
              There is no inference server. The page ships the model and the runtime, then every computation happens in a sandboxed worker on your device. The browser enforces the boundary too: the content security policy only lets scripts make network requests back to this site, which blocks uploads to third-party servers.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                [Lock, "No patient data processed by us, which removes a whole class of compliance work"],
                [ShieldCheck, "Cross-origin isolation and a restrictive content security policy on every response"],
                [Boxes, "Zero marginal compute cost per analysis, so the free tier stays free"],
                [Cpu, "Works offline once loaded: the model and runtime are cached on the device"],
              ].map(([Icon, t]) => {
                const I = Icon as typeof Lock;
                return (
                  <li key={t as string} className="flex gap-3">
                    <I className="mt-0.5 size-4 shrink-0 text-ok" />
                    <span className="text-muted">{t as string}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <pre className="overflow-x-auto rounded-2xl border border-border bg-viewer p-5 font-mono text-[12.5px] leading-relaxed text-[#c9cadb] shadow-card">
            <code>
              <span className="text-[#8b8aff]">content-security-policy</span>
              {":\n  default-src 'self';\n  "}
              <span className="text-[#fbbf24]">{"connect-src 'self';"}</span>
              {"\n  script-src 'self' 'wasm-unsafe-eval' ...;\n  worker-src 'self' blob:;\n  frame-ancestors 'none'\n\n"}
              <span className="text-[#8b8aff]">cross-origin-opener-policy</span>
              {": same-origin\n"}
              <span className="text-[#8b8aff]">cross-origin-embedder-policy</span>
              {": require-corp"}
            </code>
          </pre>
        </section>

        {/* ------------------------------------------------------------ product */}
        <section id="product" className="scroll-mt-20 border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-accent">Product</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">From a browser tab to the lab network</h2>
              <p className="mt-4 text-muted">
                The same engine powers three ways to work. Research labs start free. Diagnostic labs, CROs and scanner vendors get the batch, audit and integration features they need.
              </p>
            </div>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {[
                { n: "Research", tag: "Available now", d: "The Studio you can open today.", f: ["Unlimited local analyses", "H&E and IHC nucleus metrics", "CSV, GeoJSON and report export", "Classical baseline engine"], cta: true },
                { n: "Lab", tag: "Pilot", d: "For pathology and research core facilities.", f: ["Whole-slide streaming for SVS and pyramidal TIFF", "Batch queues on lab workstations", "Validated, versioned protocols", "Audit trail and SSO"] },
                { n: "Platform", tag: "Partners", d: "For scanner, LIS and CRO software teams.", f: ["Embeddable SDK for web and desktop", "Custom models fine-tuned on partner data", "On-premise deployment, no cloud dependency", "Regulatory documentation support"] },
              ].map((p) => (
                <div key={p.n} className={`flex flex-col rounded-2xl border p-6 ${p.cta ? "border-accent bg-bg shadow-card" : "border-border bg-bg"}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{p.n}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.cta ? "bg-accent-soft text-accent" : "bg-sunken text-muted"}`}>{p.tag}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{p.d}</p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {p.f.map((x) => (
                      <li key={x} className="flex gap-2">
                        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
                        {x}
                      </li>
                    ))}
                  </ul>
                  {p.cta ? (
                    <Link href="/studio" className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-accent-fill px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-fill-hover">
                      Open the Studio <ArrowRight className="size-4" />
                    </Link>
                  ) : CONTACT ? (
                    <a href={`mailto:${CONTACT}?subject=Karyon ${p.n}`} className="mt-6 inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:border-border-strong">
                      Talk to us
                    </a>
                  ) : (
                    <p className="mt-6 text-center text-xs text-faint">On the roadmap</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ roadmap */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Roadmap</h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Real-tissue fine-tuning", "Fine-tune on licensed, annotated cohorts (MoNuSeg, PanNuke, Lizard class maps) with the included training pipeline."],
              ["Cell classification", "Add a type head for epithelial, lymphocyte, stromal, neutrophil and necrotic nuclei."],
              ["Whole-slide viewing", "Stream tiles from pyramidal TIFF and SVS so gigapixel slides open without conversion."],
              ["Tissue and tumour regions", "Region segmentation for tumour-stroma ratio and hotspot-based Ki-67 counting."],
              ["Assisted annotation", "Correct outlines in the viewer and fine-tune on the device from those corrections."],
              ["Standards", "DICOM WSI and FHIR DiagnosticReport export for LIS integration."],
            ].map(([t, d], i) => (
              <li key={t} className="bg-bg p-6">
                <p className="font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</p>
                <p className="mt-1 font-medium">{t}</p>
                <p className="mt-1.5 text-sm text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-4 pb-24 sm:px-6">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#2b2a8f] via-[#4b4acf] to-[#b8397a] px-6 py-14 text-center text-white sm:px-12">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">See it on your own images</h2>
            <p className="mx-auto mt-3 max-w-lg text-white/80">Drop a tile into the Studio. It never leaves your computer, so there is nothing to sign up for.</p>
            <Link href="/studio" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90">
              Open the Studio <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
