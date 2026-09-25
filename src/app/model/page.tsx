import type { Metadata } from "next";
import Link from "next/link";
import card from "@/data/model-card.json";
import { SiteFooter, SiteHeader } from "@/components/brand";

export const metadata: Metadata = {
  title: "Model card",
  description: "Architecture, training data, held-out metrics, calibration and limitations of the karyon-nuclei-v1 segmentation model.",
};

type M = typeof card.test.karyon.all;
const p = (v: number) => (v * 100).toFixed(1);

function MetricsTable({ rows }: { rows: [string, M, M][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="tabular w-full min-w-[560px] text-left text-sm">
        <thead className="bg-sunken text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Subset</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Engine</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">PQ</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">DQ</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">SQ</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">AJI</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Dice</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">F1</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(([name, k, c]) =>
            [
              ["Karyon U-Net", k, true],
              ["Classical", c, false],
            ].map(([engine, m, bold], i) => {
              const mm = m as M;
              return (
                <tr key={`${name}-${engine}`} className={`border-t border-border ${bold ? "font-medium" : "text-muted"}`}>
                  <td className="px-4 py-2">{i === 0 ? name : ""}</td>
                  <td className="px-4 py-2">{engine as string}</td>
                  <td className="px-4 py-2 text-right font-mono">{p(mm.pq)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p(mm.dq)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p(mm.sq)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p(mm.aji)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p(mm.dice)}</td>
                  <td className="px-4 py-2 text-right font-mono">{p(mm.f1_det)}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 border-t border-border pt-10 text-2xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export default function ModelCard() {
  const t = card.test;
  const toc = [
    ["overview", "Overview"],
    ["intended-use", "Intended use"],
    ["architecture", "Architecture"],
    ["data", "Training data"],
    ["results", "Results"],
    ["iteration", "Iteration history"],
    ["limitations", "Limitations"],
    ["reproduce", "Reproduce"],
  ];
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1.5 text-sm">
            {toc.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted hover:text-text">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="min-w-0 space-y-6 leading-relaxed">
          <header id="overview" className="space-y-4">
            <p className="font-mono text-xs text-faint">{card.model.name} · ONNX opset {card.export.opset} · Apache-2.0</p>
            <h1 className="text-4xl font-semibold tracking-tight">Model card</h1>
            <p className="max-w-2xl text-lg text-muted">
              A {(card.model.params / 1e6).toFixed(2)} M parameter U-Net that predicts nucleus foreground, contours and a distance map, followed by marker-controlled watershed. It is small enough to download in seconds and run on a laptop CPU.
            </p>
            <dl className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Parameters", `${(card.model.params / 1e6).toFixed(2)} M`],
                ["ONNX size", `${(card.model.onnx_bytes / 1e6).toFixed(1)} MB`],
                ["Latency", `${card.latency_ms_256_cpu2} ms / tile*`],
                ["Test PQ", p(t.karyon.all.pq)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border bg-surface p-3">
                  <dt className="text-xs text-faint">{k}</dt>
                  <dd className="tabular mt-1 text-lg font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-faint">* Native ONNX Runtime on 2 CPU cores, one 256 x 256 tile. In-browser speed depends on the device and on WebGPU availability.</p>
          </header>

          <H2 id="intended-use">Intended use</H2>
          <p>
            Research and education: counting and measuring nuclei, estimating Ki-67 style positive indices, exploring stain separation, and producing pre-annotations for QuPath. The model works on brightfield H&amp;E and hematoxylin-DAB tiles at about 0.5 µm per pixel (20x); other resolutions are resampled automatically.
          </p>
          <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
            Not a medical device. Outputs must not be used for diagnosis, grading or treatment decisions. Any clinical use requires validation on local data under the applicable regulatory framework.
          </p>

          <H2 id="architecture">Architecture</H2>
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li>Encoder and decoder of Conv-BN-ReLU blocks with channels {card.model.channels.join(", ")}; bilinear upsampling and skip connections. Output stride 16.</li>
            <li>Three 1x1 heads: foreground (BCE + Dice), inner contour (weighted BCE + Dice) and per-nucleus normalised distance (weighted MSE).</li>
            <li>Input normalisation and sigmoids are compiled into the ONNX graph, so the browser feeds raw RGB. Export parity with PyTorch: max absolute error {card.export.max_abs_err_vs_torch.toExponential(1)}.</li>
            <li>Sliding window inference with 256 px tiles, 32 px overlap and raised-cosine blending.</li>
            <li>
              Post-processing: foreground &gt; {card.postprocess.t_fg}, markers where distance &gt; {card.postprocess.t_marker} and contour &lt; {card.postprocess.t_contour}, bucketed priority-flood watershed, minimum area {card.postprocess.min_area} px. Thresholds were tuned on the validation split only. The TypeScript implementation is bit-exact with the Python reference and this is enforced by a shared test fixture.
            </li>
          </ul>

          <H2 id="data">Training data</H2>
          <p>
            Version 1 is trained entirely on procedurally generated tiles (generator v2). The generator composes images in optical-density space with the Beer-Lambert law, the same physics that colour deconvolution inverts, and randomises what varies between labs: stain vectors and intensities, section thickness, focus, scanner noise, white balance and JPEG compression.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/synth-grid.jpg" alt="Grid of twelve synthetic H&E and IHC training tiles" width={1536} height={512} className="w-full rounded-xl border border-border" loading="lazy" />
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li>Nuclei are Fourier-perturbed ellipses with chromatin texture, nuclear rims and nucleoli, drawn from four populations: pleomorphic tumour cells, lymphocytes, spindle fibroblasts and columnar epithelium. Overlap is allowed but bounded: a new nucleus may cover at most 40% of any nucleus already placed, which keeps unlabelled stained fragments rare.</li>
            <li>Glands are rendered as columnar epithelium around a lumen, with cell membranes and radially oriented, basal nuclei.</li>
            <li>Stroma has warped, oriented collagen texture; red blood cells and debris are included as unlabelled hard negatives.</li>
            <li>30% of tiles are H-DAB immunohistochemistry with a variable fraction of DAB-positive nuclei. About a quarter of them contain glands with membranous and cytoplasmic DAB, which overlies negative nuclei the way it does in real sections.</li>
            <li>
              {card.training.train_tiles.toLocaleString()} training, {card.training.val_tiles} validation and {t.n_tiles} test tiles at 256 x 256, from disjoint seed ranges. Training used {card.training.iters.toLocaleString()} iterations, batch {card.training.batch}, {card.training.crop} px crops, {card.training.optimizer}, HED stain augmentation, on {card.training.hardware} ({card.training.hours} h).
            </li>
          </ul>

          <H2 id="results">Results on the held-out test split</H2>
          <MetricsTable
            rows={[
              ["All tiles", t.karyon.all, t.classical.all],
              ["H&E", t.karyon.he, t.classical.he],
              ["IHC", t.karyon.ihc, t.classical.ihc],
            ]}
          />
          <p>
            Positivity is scored on nuclear minus perinuclear DAB rather than on the mean nuclear DAB. On tiles with membranous staining, cytoplasmic DAB lying over negative nuclei made the simple rule call them positive; the contrast score removes most of that error.
          </p>
          <p className="text-sm text-muted">
            PQ is panoptic quality (Kirillov et al., 2019) as used by PanNuke and CoNIC, AJI is the aggregated Jaccard index (Kumar et al., 2017), F1 is detection F1 at IoU 0.5. Per-tile PQ spread for the U-Net: 10th percentile {p(t.karyon.pq_p10_p50_p90[0])}, median {p(t.karyon.pq_p10_p50_p90[1])}, 90th percentile {p(t.karyon.pq_p10_p50_p90[2])}.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm text-muted">Ki-67 index error (IHC tiles)</p>
              <p className="tabular mt-1 text-2xl font-semibold">{t.ki67_index_mae_pp.karyon?.toFixed(1)} pp</p>
              <p className="text-xs text-faint">
                mean absolute error in percentage points over {t.ki67_index_mae_pp.n_tiles} tiles; classical {t.ki67_index_mae_pp.classical?.toFixed(1)} pp; scoring on mean nuclear DAB alone {t.ki67_index_mae_pp.mean_dab_rule.toFixed(1)} pp
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm text-muted">DAB positivity threshold</p>
              <p className="tabular mt-1 text-2xl font-semibold">{card.t_dab} OD</p>
              <p className="text-xs text-faint">on the DAB score (nuclear minus perinuclear DAB), calibrated for balanced accuracy on validation ground truth</p>
            </div>
          </div>

          <H2 id="iteration">Iteration history</H2>
          <p>
            An earlier checkpoint was trained on a first generator that only modelled stroma and scattered nuclei. On synthetic data it already scored well, but a qualitative check on a real IHC micrograph showed it missing almost every epithelial nucleus inside membranous DAB: it had never seen nuclei embedded in stained cytoplasm. The generator was extended with glands, columnar epithelium, membranous DAB and DAB overlying negative nuclei, and the released model was retrained from scratch.
          </p>
          <figure className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/real-before-after.jpg" alt="Real IHC micrograph segmented by the earlier checkpoint (left) and the released model (right)" width={1032} height={512} className="w-full rounded-xl border border-border" loading="lazy" />
            <figcaption className="text-xs text-faint">Real colonic IHC (scikit-image sample data), no ground truth available. Left: earlier checkpoint. Right: released model.</figcaption>
          </figure>

          <H2 id="limitations">Limitations</H2>
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li>
              <strong className="text-text">Synthetic-only training.</strong> The benchmark above measures the model on data from the same generator. Real tissue has structures the generator does not model (mitoses, necrosis, mucin, tissue folds, pen marks, out-of-focus regions), so expect lower scores on real slides until the model is fine-tuned on annotated real data. The pipeline includes a loader for that.
            </li>
            <li><strong className="text-text">Positivity assumes a nuclear marker.</strong> The DAB score subtracts the perinuclear DAB so that membranous or cytoplasmic staining does not make negative nuclei positive. It is designed for nuclear markers such as Ki-67, ER, PR and p53, not for membrane scores such as HER2.</li>
            <li><strong className="text-text">Fixed stain vectors by default.</strong> Deconvolution uses the Ruifrok hematoxylin and DAB vectors. When a lab&apos;s counterstain is bluer or greyer, hematoxylin leaks into the DAB channel; the Studio option to estimate the counterstain vector from the segmented nuclei reduces this: on the real IHC sample, nuclei scored positive fall from about 21% to 7% (checked by an end-to-end test). The positivity threshold was calibrated with the fixed vectors.</li>
            <li><strong className="text-text">No cell typing.</strong> Nuclei are not classified into cell types, and the positive index counts all nuclei in the field, including stromal and immune cells.</li>
            <li><strong className="text-text">Tiles, not slides.</strong> Inputs up to 64 megapixels; analysis runs at up to 12 megapixels of working resolution.</li>
            <li>Fairness across patient populations cannot be assessed on synthetic data and must be part of any real-data validation.</li>
          </ul>

          <H2 id="reproduce">Reproduce</H2>
          <pre className="overflow-x-auto rounded-xl border border-border bg-viewer p-4 font-mono text-[12.5px] leading-relaxed text-[#d4d5e4]">
            <code>{`cd ml
pip install -e ".[dev]"
python scripts/build_dataset.py --out data/synth_v2          # deterministic
python -m karyon_ml.train --config configs/unet_s.yaml
python -m karyon_ml.export_onnx --ckpt runs/unet_s/best.pt \\
    --out ../public/models/karyon-nuclei-v1.onnx            # parity-checked
python -m karyon_ml.evaluate --ckpt runs/unet_s/best.pt \\
    --onnx ../public/models/karyon-nuclei-v1.onnx --card ../src/data/model-card.json
python scripts/finalize_card.py --run runs/unet_s           # hash, training metadata
python scripts/make_samples.py && python scripts/make_figures.py --ckpt runs/unet_s/best.pt
python scripts/make_parity_fixture.py runs/unet_s/best.pt   # web parity fixtures
pytest -q`}</code>
          </pre>
          <p className="font-mono text-xs text-faint break-all">sha256 {card.export.sha256}</p>
          <p className="text-sm text-muted">
            Ready to try it? <Link href="/studio" className="font-medium text-accent hover:underline">Open the Studio</Link>.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
