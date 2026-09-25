"use client";

import { AlertTriangle, Download, FileJson, FileSpreadsheet, ImageDown, Loader2, Play, RotateCcw, Upload, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import card from "@/data/model-card.json";
import samples from "@/data/samples.json";
import { useEngine } from "@/hooks/useEngine";
import { ACCEPTED, decodeBlob, decodeUrl, type Decoded } from "@/lib/decode";
import { downloadBlob, downloadText, stem } from "@/lib/download";
import { buildOverlay, COLORS, edgeMask, heatmap } from "@/lib/overlay";
import { summarize, toCSV, toGeoJSON, toReport } from "@/lib/pathology/export";
import type { RGBAImage } from "@/lib/pathology/image";
import type { PostprocessParams } from "@/lib/pathology/postprocess";
import type { AnalysisResult, Engine } from "@/lib/pathology/types";
import type { StainKind } from "@/lib/pathology/stain";
import { SITE } from "@/lib/site";
import { Histogram } from "./Histogram";
import { Kpi, Section, Segmented, Slider, Switch } from "./controls";
import { NucleusTable } from "./NucleusTable";
import { Viewer } from "./Viewer";

type Sample = (typeof samples)[number];
type Layer = "working" | "normalized" | "stain1" | "stain2" | "probability";

interface Settings {
  engine: Engine;
  stain: StainKind | "auto";
  mpp: number;
  normalize: boolean;
  adaptStain: boolean;
  pp: PostprocessParams;
}

const DEFAULT_PP: PostprocessParams = {
  tFg: card.postprocess.t_fg,
  tMarker: card.postprocess.t_marker,
  tContour: card.postprocess.t_contour,
  minMarker: card.postprocess.min_marker,
  minArea: card.postprocess.min_area,
};
const DEFAULT_SETTINGS: Settings = { engine: "deep", stain: "auto", mpp: 0.5, normalize: false, adaptStain: false, pp: DEFAULT_PP };
type MppPreset = "0.25" | "0.5" | "1";
const MPP_PRESETS: { value: MppPreset; label: string; hint: string }[] = [
  { value: "0.25", label: "40x", hint: "0.25 µm per pixel" },
  { value: "0.5", label: "20x", hint: "0.5 µm per pixel" },
  { value: "1", label: "10x", hint: "1.0 µm per pixel" },
];

type RunState = { state: "idle" } | { state: "decoding" } | { state: "running"; stage: string; fraction: number } | { state: "error"; message: string };

const MAX_WORKING_PIXELS = 12_000_000;
const fmt = (v: number, d = 1) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export function Studio() {
  const { status, analyze, cancel } = useEngine();
  const [source, setSource] = useState<{ img: RGBAImage; name: string; sample: Sample | null; key: number } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ranWith, setRanWith] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dab, setDab] = useState<number>(card.t_dab);
  const [layer, setLayer] = useState<Layer>("working");
  const [ov, setOv] = useState({ outline: true, fill: false, opacity: 0.95 });
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ id: number; nonce: number } | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;
  const [mppText, setMppText] = useState("0.5");
  const fileInput = useRef<HTMLInputElement>(null);
  const runToken = useRef(0);

  const execute = useCallback(
    async (src: { img: RGBAImage }, s: Settings) => {
      const token = ++runToken.current;
      setRun({ state: "running", stage: status.state === "loading" && s.engine === "deep" ? "Loading model" : "Starting", fraction: 0 });
      setSelected(null);
      try {
        const r = await analyze(src.img, { engine: s.engine, stain: s.stain, mpp: s.mpp, normalize: s.normalize, adaptStain: s.adaptStain, postprocess: s.pp, maxWorkingPixels: MAX_WORKING_PIXELS }, (stage, fraction) => {
          if (token === runToken.current) setRun({ state: "running", stage, fraction });
        });
        if (token !== runToken.current) return;
        setResult(r);
        setRanWith(JSON.stringify(s));
        setLayer((l) => (l === "normalized" && !r.layers.normalized) || (l === "probability" && !r.layers.probability) ? "working" : l);
        setRun({ state: "idle" });
      } catch (e) {
        if (token !== runToken.current) return;
        const message = e instanceof Error ? e.message : String(e);
        setRun(message === "cancelled" ? { state: "idle" } : { state: "error", message });
      }
    },
    [analyze, status.state],
  );

  const load = useCallback(
    async (get: () => Promise<Decoded>, name: string, sample: Sample | null) => {
      // a new image supersedes whatever is running or about to report
      const token = ++runToken.current;
      cancel();
      setRun({ state: "decoding" });
      setResult(null);
      try {
        const img = await get();
        if (token !== runToken.current) return;
        const src = { img, name, sample, key: Date.now() };
        setSource(src);
        const mpp = sample?.mpp ?? img.mpp;
        const s = mpp ? { ...settings, mpp: Math.round(mpp * 1000) / 1000 } : settings;
        setSettings(s);
        setMppText(String(s.mpp));
        await execute(src, s);
      } catch (e) {
        if (token === runToken.current) setRun({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [execute, settings, cancel],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f) load(() => decodeBlob(f, f.name), f.name, null);
    },
    [load],
  );

  const loadSample = useCallback((s: Sample) => load(() => decodeUrl(s.src), s.id, s), [load]);

  // deep links: /studio?sample=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("sample");
    const s = samples.find((x) => x.id === id);
    if (!s) return;
    const t = setTimeout(() => loadSample(s), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = !!result && !!ranWith && ranWith !== JSON.stringify(settings);
  const busy = run.state === "running" || run.state === "decoding";

  // ------------------------------------------------------------------ layers & overlay
  const baseImage = useMemo(() => {
    if (result) {
      const { width: w, height: h, layers: L } = result;
      const pick = (d: Uint8ClampedArray) => new ImageData(d as Uint8ClampedArray<ArrayBuffer>, w, h);
      if (layer === "normalized" && L.normalized) return pick(L.normalized);
      if (layer === "stain1") return pick(L.stain1);
      if (layer === "stain2") return pick(L.stain2);
      if (layer === "probability" && L.probability) return heatmap(L.probability, w, h);
      return pick(L.working);
    }
    if (source) return new ImageData(source.img.data as Uint8ClampedArray<ArrayBuffer>, source.img.width, source.img.height);
    return null;
  }, [result, source, layer]);

  // the threshold drives an O(pixels) recolour; defer it so the slider itself never stutters
  const dabDeferred = useDeferredValue(dab);
  const mask = useMemo(() => (result ? edgeMask(result.labels, result.width, result.height) : null), [result]);
  const overlay = useMemo(() => {
    if (!result || !mask || (!ov.outline && !ov.fill)) return null;
    const ihc = result.stain === "ihc";
    return buildOverlay(
      result.labels,
      mask,
      result.width,
      result.height,
      (id) => (ihc ? (result.nuclei[id - 1].contrastS2 > dabDeferred ? COLORS.positive : COLORS.negative) : COLORS.nucleus),
      { outline: ov.outline, fill: ov.fill, count: result.count },
    );
  }, [result, mask, dabDeferred, ov.outline, ov.fill]);

  const dist = useMemo(
    () => (result ? { dab: result.nuclei.map((n) => n.contrastS2), area: result.nuclei.map((n) => n.areaUm2), circ: result.nuclei.map((n) => n.circularity) } : null),
    [result],
  );

  const summary = useMemo(() => (result ? summarize(result, dab) : null), [result, dab]);

  // ------------------------------------------------------------------ exports
  const base = stem(source?.name ?? "karyon");
  const exportCSV = () => result && downloadText(toCSV(result, dab), `${base}.nuclei.csv`, "text/csv");
  const exportGeoJSON = () => result && downloadText(JSON.stringify(toGeoJSON(result, dab)), `${base}.nuclei.geojson`, "application/geo+json");
  const exportReport = () =>
    result &&
    downloadText(
      JSON.stringify(toReport(result, dab, { model: SITE.modelVersion, app: SITE.appVersion, source: source?.name, settings }), null, 2),
      `${base}.report.json`,
      "application/json",
    );
  const exportPNG = () => {
    if (!result || !baseImage) return;
    const c = document.createElement("canvas");
    c.width = result.width;
    c.height = result.height;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(baseImage, 0, 0);
    if (overlay) {
      const o = document.createElement("canvas");
      o.width = result.width;
      o.height = result.height;
      o.getContext("2d")!.putImageData(overlay, 0, 0);
      ctx.drawImage(o, 0, 0);
    }
    c.toBlob((b) => b && downloadBlob(b, `${base}.overlay.png`), "image/png");
  };

  const s2Name = result?.stain === "ihc" || (settings.stain === "ihc" && !result) ? "DAB" : "Eosin";

  const tooltip = (id: number) => {
    const n = result?.nuclei[id - 1];
    if (!n) return null;
    const ihc = result!.stain === "ihc";
    const pos = ihc && n.contrastS2 > dab;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Nucleus #{n.id}</span>
          {ihc && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pos ? "bg-[#ff8020]/25 text-[#ffb27a]" : "bg-[#50aaff]/25 text-[#a7d3ff]"}`}>{pos ? "DAB positive" : "Negative"}</span>}
        </div>
        <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-white/80">
          <dt>Area</dt><dd className="text-right">{fmt(n.areaUm2)} µm²</dd>
          <dt>Perimeter</dt><dd className="text-right">{fmt(n.perimeterUm)} µm</dd>
          <dt>Circularity</dt><dd className="text-right">{fmt(n.circularity, 2)}</dd>
          <dt>Eccentricity</dt><dd className="text-right">{fmt(n.eccentricity, 2)}</dd>
          <dt>Hematoxylin</dt><dd className="text-right">{fmt(n.meanH, 3)}</dd>
          <dt>{ihc ? "DAB" : "Eosin"}</dt><dd className="text-right">{fmt(n.meanS2, 3)}</dd>
          {ihc && (<><dt>DAB score</dt><dd className="text-right">{fmt(n.contrastS2, 3)}</dd></>)}
        </dl>
      </div>
    );
  };

  const gt = source?.sample?.groundTruth ?? null;

  return (
    <div
      className="relative flex flex-col lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[300px_minmax(0,1fr)_360px]"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        e.preventDefault();
        setDragDepth(0);
        onFiles(e.dataTransfer.files);
      }}
    >
      {/* ------------------------------------------------------------ settings */}
      <aside className="order-2 space-y-6 overflow-y-auto border-border bg-bg p-4 lg:order-1 lg:border-r" aria-label="Analysis settings">
        <EngineBadge status={status} />

        <Section title="Image">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-3 py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
          >
            <Upload className="size-4" /> Open image
          </button>
          <input ref={fileInput} type="file" accept={ACCEPTED} className="sr-only" onChange={(e) => onFiles(e.target.files)} aria-label="Open image file" />
          <p className="text-xs text-faint">PNG, JPEG, WebP or TIFF up to 64 MP. Files never leave this device.</p>
          <div className="grid grid-cols-3 gap-1.5">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => loadSample(s)}
                title={s.title}
                aria-label={`Load sample: ${s.title}`}
                className={`overflow-hidden rounded-lg border transition ${source?.sample?.id === s.id ? "border-accent ring-2 ring-[var(--ring)]" : "border-border hover:border-border-strong"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.thumb} alt="" width={160} height={160} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        </Section>

        <Section title="Engine">
          <Segmented
            label="Segmentation engine"
            value={settings.engine}
            onChange={(engine) => setSettings({ ...settings, engine })}
            options={[
              { value: "deep", label: "Deep U-Net", hint: "ONNX model, WebGPU or WebAssembly" },
              { value: "classical", label: "Classical", hint: "Otsu + watershed baseline" },
            ]}
          />
        </Section>

        <Section title="Stain">
          <Segmented
            label="Stain type"
            value={settings.stain}
            onChange={(stain) => setSettings({ ...settings, stain })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "he", label: "H&E" },
              { value: "ihc", label: "IHC" },
            ]}
          />
          <Switch
            checked={settings.normalize}
            onChange={(normalize) => setSettings({ ...settings, normalize })}
            label="Macenko normalisation"
            hint="Map H&E colours to a reference before segmentation"
            disabled={settings.stain === "ihc"}
          />
          <Switch
            checked={settings.adaptStain}
            onChange={(adaptStain) => setSettings({ ...settings, adaptStain })}
            label="Estimate counterstain vector"
            hint="IHC: fit hematoxylin to this image's nuclei. Try it when blue nuclei are called positive."
            disabled={settings.stain === "he"}
          />
        </Section>

        <Section title="Scan resolution">
          <Segmented
            label="Objective magnification"
            value={String(settings.mpp) as MppPreset}
            onChange={(v) => {
              setSettings({ ...settings, mpp: Number(v) });
              setMppText(v);
            }}
            options={MPP_PRESETS}
          />
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted">Microns per pixel</span>
            <input
              type="number"
              min={0.05}
              max={4}
              step={0.01}
              inputMode="decimal"
              value={mppText}
              aria-invalid={!(Number(mppText) > 0.04 && Number(mppText) <= 4)}
              onChange={(e) => {
                setMppText(e.target.value);
                const v = Number(e.target.value);
                if (v > 0.04 && v <= 4) setSettings({ ...settings, mpp: v });
              }}
              onBlur={() => setMppText(String(settings.mpp))}
              className="tabular w-24 rounded-lg border border-border bg-surface px-2 py-1 text-right font-mono text-sm"
            />
          </label>
        </Section>

        <details className="group space-y-3">
          <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-muted">
            <span className="inline-block transition group-open:rotate-90">›</span> Advanced
          </summary>
          <div className="space-y-4 pt-3">
            <Slider label="Foreground threshold" value={settings.pp.tFg} min={0.2} max={0.8} step={0.02} onChange={(tFg) => setSettings({ ...settings, pp: { ...settings.pp, tFg } })} format={(v) => v.toFixed(2)} />
            <Slider label="Marker threshold" value={settings.pp.tMarker} min={0.2} max={0.8} step={0.02} onChange={(tMarker) => setSettings({ ...settings, pp: { ...settings.pp, tMarker } })} format={(v) => v.toFixed(2)} hint="Lower splits more touching nuclei" />
            <Slider label="Minimum area" value={settings.pp.minArea} min={4} max={80} step={1} onChange={(minArea) => setSettings({ ...settings, pp: { ...settings.pp, minArea } })} format={(v) => `${v} px`} />
            <button type="button" onClick={() => setSettings({ ...DEFAULT_SETTINGS, mpp: settings.mpp })} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
              <RotateCcw className="size-3.5" /> Reset to model defaults
            </button>
          </div>
        </details>

        <div className="sticky bottom-0 -mx-4 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur">
          <button
            type="button"
            disabled={!source || busy}
            onClick={() => source && execute(source, settings)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-fill px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {busy ? "Analysing" : stale ? "Re-run with new settings" : "Run analysis"}
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------------------ viewer */}
      <main id="main" className="relative order-1 h-[62vh] min-h-[360px] lg:order-2 lg:h-auto">
        {source && <h1 className="sr-only">Karyon Studio</h1>}
        <Viewer
          base={baseImage}
          overlay={overlay}
          overlayOpacity={ov.opacity}
          labels={result?.labels ?? null}
          polygons={result?.polygons ?? null}
          mpp={result ? result.workingMpp : source ? settings.mpp : null}
          selected={selected}
          onSelect={setSelected}
          focus={focus}
          tooltip={tooltip}
          resetKey={source?.key ?? 0}
        >
          {!source && run.state !== "decoding" && <EmptyState onOpen={() => fileInput.current?.click()} onSample={loadSample} />}
          {result && (
            <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 text-white/90 shadow-lg backdrop-blur-md">
              {(
                [
                  ["working", "Original"],
                  ["normalized", "Normalised"],
                  ["stain1", "Hematoxylin"],
                  ["stain2", result.stain === "ihc" ? "DAB" : "Eosin"],
                  ["probability", "Probability"],
                ] as [Layer, string][]
              )
                .filter(([k]) => (k !== "normalized" || result.layers.normalized) && (k !== "probability" || result.layers.probability))
                .map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setLayer(k)} aria-pressed={layer === k} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${layer === k ? "bg-white text-black" : "hover:bg-white/10"}`}>
                    {label}
                  </button>
                ))}
              <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />
              <button type="button" onClick={() => setOv({ ...ov, outline: !ov.outline })} aria-pressed={ov.outline} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${ov.outline ? "bg-white/20" : "hover:bg-white/10"}`}>
                Outlines
              </button>
              <button type="button" onClick={() => setOv({ ...ov, fill: !ov.fill })} aria-pressed={ov.fill} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${ov.fill ? "bg-white/20" : "hover:bg-white/10"}`}>
                Fill
              </button>
            </div>
          )}
          {busy && (
            <div className="absolute inset-x-0 bottom-0 z-20 p-4">
              <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-black/70 p-3 text-white shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {run.state === "running" ? run.stage : "Decoding image"}
                  </span>
                  <span className="flex items-center gap-2">
                    {run.state === "running" && <span className="tabular font-mono">{Math.round(run.fraction * 100)}%</span>}
                    {run.state === "running" && (
                      <button type="button" onClick={cancel} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-white/80 hover:bg-white/10 hover:text-white">
                        <X className="size-3.5" aria-hidden /> Cancel
                      </button>
                    )}
                  </span>
                </div>
                <div
                  className="mt-2 h-1 overflow-hidden rounded-full bg-white/15"
                  role="progressbar"
                  aria-label="Analysis progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={run.state === "running" ? Math.round(run.fraction * 100) : undefined}
                >
                  <div className="h-full rounded-full bg-gradient-to-r from-[#7c7bff] to-[#f472b6] transition-[width] duration-300" style={{ width: `${run.state === "running" ? Math.max(4, run.fraction * 100) : 8}%` }} />
                </div>
              </div>
            </div>
          )}
          {run.state === "error" && (
            <div className="absolute inset-x-0 bottom-0 z-20 p-4" role="alert">
              <div className="mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-danger/40 bg-black/80 p-3 text-sm text-white shadow-2xl">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#fdba74]" />
                <div className="space-y-1">
                  <p className="font-medium">Analysis failed</p>
                  <p className="text-white/75">{run.message}</p>
                  {settings.engine === "deep" && status.state === "error" && (
                    <button
                      type="button"
                      className="text-xs font-medium text-[#c7c6ff] underline"
                      onClick={() => {
                        const s = { ...settings, engine: "classical" as const };
                        setSettings(s);
                        if (source) execute(source, s);
                      }}
                    >
                      Try the classical engine instead
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </Viewer>
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 text-sm font-semibold text-white backdrop-blur-sm">
            Drop to analyse locally
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------ results */}
      <aside className="order-3 space-y-5 overflow-y-auto border-border bg-bg p-4 lg:border-l" aria-label="Results">
        {!result || !summary ? (
          <div className="space-y-2 pt-2 text-sm text-muted">
            <h2 className="text-base font-semibold text-text">Results</h2>
            <p>Open an image or pick a sample. Counts, morphometry and IHC scores appear here, with CSV and QuPath exports.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Results</h2>
                <p className="text-xs text-muted">
                  {result.stain === "ihc" ? "IHC (H-DAB)" : "H&E"}
                  {result.stainDetected ? " detected" : ""} · {result.engine === "deep" ? `U-Net on ${result.backend === "webgpu" ? "WebGPU" : "WebAssembly"}` : "Classical"} · {fmt(result.timings.totalMs / 1000, 2)} s
                </p>
              </div>
              {stale && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">Settings changed</span>}
            </div>

            {result.warnings.map((w) => (
              <p key={w} className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">{w}</p>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <Kpi
                label="Nuclei"
                value={summary.count.toLocaleString()}
                sub={gt ? <>Ground truth {gt.nuclei.toLocaleString()} ({signed((100 * (summary.count - gt.nuclei)) / Math.max(1, gt.nuclei))}%)</> : `${fmt(summary.areaMm2, 3)} mm² analysed`}
              />
              <Kpi label="Density" value={<>{Math.round(summary.densityPerMm2).toLocaleString()}<span className="text-sm font-normal text-muted"> /mm²</span></>} />
              {summary.positiveIndex !== null ? (
                <>
                  <Kpi
                    label="Positive index"
                    tone="pos"
                    value={`${fmt(summary.positiveIndex)}%`}
                    sub={gt?.positivePct != null ? <>Ground truth {fmt(gt.positivePct)}%</> : `${summary.positive.toLocaleString()} of ${summary.count.toLocaleString()}`}
                  />
                  <Kpi label="H-score" value={fmt(summary.hScore ?? 0, 0)} sub="0 to 300, weak / moderate / strong bins" />
                </>
              ) : (
                <>
                  <Kpi label="Mean area" value={<>{fmt(summary.meanAreaUm2)}<span className="text-sm font-normal text-muted"> µm²</span></>} sub={`median ${fmt(summary.medianAreaUm2)} µm²`} />
                  <Kpi label="Circularity" value={fmt(summary.meanCircularity, 2)} sub="mean, 1.0 is a perfect circle" />
                </>
              )}
            </div>

            <div aria-live="polite">
              {selected && result.nuclei[selected - 1] && (
                <SelectedCard n={result.nuclei[selected - 1]} ihc={result.stain === "ihc"} threshold={dab} onClear={() => setSelected(null)} />
              )}
            </div>

            {result.stain === "ihc" && (
              <Section title="DAB positivity">
                <Histogram values={dist!.dab} threshold={dab} label="Nuclear minus perinuclear DAB (OD)" format={(v) => v.toFixed(2)} colorBelow="var(--neg)" />
                <Slider label="Positivity threshold" value={dab} min={0} max={1} step={0.005} onChange={setDab} format={(v) => `${v.toFixed(3)} OD`} hint={`Calibrated default ${card.t_dab} OD. Updates instantly, no re-run needed.`} />
              </Section>
            )}

            <Section title="Morphometry">
              <Histogram values={dist!.area} label="Nuclear area" unit="µm²" />
              <Histogram values={dist!.circ} domain={[0.3, 1]} label="Circularity" format={(v) => v.toFixed(2)} />
            </Section>

            <Section title="Display">
              <Slider label="Overlay opacity" value={ov.opacity} min={0} max={1} step={0.05} onChange={(opacity) => setOv({ ...ov, opacity })} format={(v) => `${Math.round(v * 100)}%`} />
            </Section>

            <Section title="Export">
              <div className="grid grid-cols-2 gap-2">
                <ExportButton icon={<FileSpreadsheet className="size-4" />} label="Nuclei CSV" onClick={exportCSV} />
                <ExportButton icon={<Download className="size-4" />} label="QuPath GeoJSON" onClick={exportGeoJSON} />
                <ExportButton icon={<FileJson className="size-4" />} label="Report JSON" onClick={exportReport} />
                <ExportButton icon={<ImageDown className="size-4" />} label="Overlay PNG" onClick={exportPNG} />
              </div>
            </Section>

            <Section title={`Nuclei (${result.count.toLocaleString()})`}>
              <NucleusTable
                nuclei={result.nuclei}
                ihc={result.stain === "ihc"}
                s2Name={s2Name}
                threshold={dab}
                selected={selected}
                onPick={(id) => {
                  setSelected(id);
                  setFocus({ id, nonce: Date.now() });
                }}
              />
            </Section>

            <Section title="Run">
              <dl className="tabular grid grid-cols-2 gap-y-1 font-mono text-xs text-muted">
                <dt>Working size</dt><dd className="text-right">{result.width} x {result.height} px</dd>
                <dt>Resolution</dt><dd className="text-right">{fmt(result.workingMpp, 3)} µm/px</dd>
                {result.engine === "deep" && (<><dt>Tiles</dt><dd className="text-right">{result.tiles}</dd></>)}
                <dt>Preprocess</dt><dd className="text-right">{result.timings.preprocessMs} ms</dd>
                <dt>{result.engine === "deep" ? "Inference" : "Segmentation"}</dt><dd className="text-right">{result.timings.inferenceMs} ms</dd>
                <dt>Instances</dt><dd className="text-right">{result.timings.postprocessMs} ms</dd>
                <dt>Measurement</dt><dd className="text-right">{result.timings.measureMs} ms</dd>
              </dl>
              {source?.sample && <p className="text-xs text-faint">Source: {source.sample.source}</p>}
            </Section>
          </>
        )}
      </aside>
    </div>
  );
}

function SelectedCard({ n, ihc, threshold, onClear }: { n: import("@/lib/pathology/features").Nucleus; ihc: boolean; threshold: number; onClear: () => void }) {
  const pos = ihc && n.contrastS2 > threshold;
  const rows: [string, string][] = [
    ["Area", `${fmt(n.areaUm2)} µm²`],
    ["Perimeter", `${fmt(n.perimeterUm)} µm`],
    ["Major / minor axis", `${fmt(n.majorUm)} / ${fmt(n.minorUm)} µm`],
    ["Circularity", fmt(n.circularity, 2)],
    ["Solidity", fmt(n.solidity, 2)],
    ["Eccentricity", fmt(n.eccentricity, 2)],
    ["Hematoxylin OD", fmt(n.meanH, 3)],
    [ihc ? "DAB OD" : "Eosin OD", fmt(n.meanS2, 3)],
    ...(ihc ? ([["Perinuclear DAB", fmt(n.ringS2, 3)], ["DAB score", fmt(n.contrastS2, 3)]] as [string, string][]) : []),
  ];
  return (
    <section className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3" aria-label={`Selected nucleus ${n.id}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Nucleus #{n.id}
          {ihc && <span className={`ml-2 text-xs font-medium ${pos ? "text-pos" : "text-neg"}`}>{pos ? "DAB positive" : "Negative"}</span>}
        </h3>
        <button type="button" onClick={onClear} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-text" aria-label="Clear selection">
          <X className="size-3.5" />
        </button>
      </div>
      <dl className="tabular mt-2 grid grid-cols-2 gap-y-1 font-mono text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

function ExportButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-[13px] font-medium transition hover:border-border-strong hover:bg-sunken">
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}

function EngineBadge({ status }: { status: ReturnType<typeof useEngine>["status"] }) {
  const tone = status.state === "ready" ? "bg-ok" : status.state === "error" ? "bg-danger" : "bg-warn animate-pulse";
  const title = status.state === "ready" ? "Model ready" : status.state === "error" ? "Model unavailable" : "Loading model";
  const detail =
    status.state === "ready"
      ? `${status.backend === "webgpu" ? "WebGPU" : "WebAssembly"}${status.backend === "wasm" ? ` · ${status.threads} thread${status.threads > 1 ? "s" : ""}` : ""}`
      : status.state === "error"
        ? "The classical engine still works"
        : "Downloading weights and runtime";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2" role="status" aria-live="polite" title={status.state === "error" ? status.message : undefined}>
      <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      <span className="shrink-0 font-mono text-[10px] text-faint">{SITE.modelVersion.replace("karyon-", "")}</span>
    </div>
  );
}

function EmptyState({ onOpen, onSample }: { onOpen: () => void; onSample: (s: Sample) => void }) {
  return (
    <div className="absolute inset-0 flex items-start justify-center overflow-y-auto p-5 sm:items-center sm:p-6">
      <div className="w-full max-w-2xl py-2 text-center text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">Runs entirely on this device</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Drop an H&E or IHC image to begin</h1>
        <p className="mx-auto mt-2 hidden max-w-md text-sm text-white/60 sm:block">Or start with a sample. Nothing is uploaded: the model, the pixels and the results stay in your browser.</p>
        <button type="button" onClick={onOpen} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90">
          <Upload className="size-4" /> Open image
        </button>
        <div className="mt-6 grid grid-cols-3 gap-2 text-left sm:mt-8 sm:gap-3">
          {samples.map((s) => (
            <button key={s.id} type="button" onClick={() => onSample(s)} aria-label={`Load sample: ${s.title}`} className="group overflow-hidden rounded-xl border border-white/10 bg-white/5 transition hover:border-white/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.thumb} alt="" width={160} height={160} className="aspect-[16/10] w-full object-cover opacity-90 transition group-hover:opacity-100" />
              <span className="hidden p-2.5 sm:block">
                <span className="block text-[13px] font-medium leading-snug">{s.title}</span>
                <span className="mt-0.5 block text-[11px] text-white/50">{s.groundTruth ? "Synthetic, with ground truth" : "Real micrograph"}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
