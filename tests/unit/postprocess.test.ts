import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instancesFromHeads, labelRaster, removeSmallAndRelabel, watershed } from "@/lib/pathology/postprocess";

const FIX = join(__dirname, "..", "fixtures");

function loadFixture(name: string) {
  const meta = JSON.parse(readFileSync(join(FIX, `parity-${name}.json`), "utf8"));
  const h = readFileSync(join(FIX, `parity-${name}.heads.bin`));
  const l = readFileSync(join(FIX, `parity-${name}.labels.bin`));
  const heads = new Float32Array(h.buffer, h.byteOffset, h.byteLength / 4);
  const labels = new Int32Array(l.buffer, l.byteOffset, l.byteLength / 4);
  const n = meta.width * meta.height;
  return { meta, fg: heads.slice(0, n), contour: heads.slice(n, 2 * n), dist: heads.slice(2 * n, 3 * n), labels };
}

describe("post-processing parity with the Python reference", () => {
  for (const name of ["synthetic", "model"]) {
    it(`matches ml/karyon_ml/postprocess.py bit for bit (${name})`, () => {
      const f = loadFixture(name);
      const p = f.meta.params;
      const out = instancesFromHeads(f.fg, f.contour, f.dist, f.meta.width, f.meta.height, {
        tFg: p.t_fg,
        tMarker: p.t_marker,
        tContour: p.t_contour,
        minMarker: p.min_marker,
        minArea: p.min_area,
      });
      expect(out.count).toBe(f.meta.count);
      let mismatches = 0;
      for (let i = 0; i < out.labels.length; i++) if (out.labels[i] !== f.labels[i]) mismatches++;
      expect(mismatches).toBe(0);
    });
  }
});

describe("labelRaster", () => {
  it("numbers components in raster order of their first pixel, 8-connected", () => {
    const w = 5, h = 5;
    const b = new Uint8Array(w * h);
    b[4] = 1; // (0,4)
    b[2 * w] = 1; // (2,0)
    b[3 * w + 1] = 1; // diagonal neighbour of (2,0)
    const { labels, count } = labelRaster(b, w, h);
    expect(count).toBe(2);
    expect(labels[4]).toBe(1);
    expect(labels[2 * w]).toBe(2);
    expect(labels[3 * w + 1]).toBe(2);
  });
});

describe("removeSmallAndRelabel", () => {
  it("drops small labels and renumbers contiguously", () => {
    const l = Int32Array.from([0, 1, 1, 2, 3, 3, 3, 0]);
    const k = removeSmallAndRelabel(l, 2);
    expect(k).toBe(2);
    expect(Array.from(l)).toEqual([0, 1, 1, 0, 2, 2, 2, 0]);
  });
});

describe("watershed", () => {
  it("splits two touching discs from two markers", () => {
    const w = 64, h = 40;
    const mask = new Uint8Array(w * h), level = new Uint8Array(w * h), lab = new Int32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d1 = Math.hypot(x - 22, y - 20), d2 = Math.hypot(x - 40, y - 20);
        if (d1 <= 11 || d2 <= 11) mask[y * w + x] = 1;
        level[y * w + x] = Math.min(255, Math.floor(Math.min(d1, d2) * 20));
      }
    lab[20 * w + 22] = 1;
    lab[20 * w + 40] = 2;
    watershed(level, lab, mask, w, h);
    expect(lab[20 * w + 15]).toBe(1);
    expect(lab[20 * w + 47]).toBe(2);
    for (let i = 0; i < mask.length; i++) expect(lab[i] > 0).toBe(mask[i] === 1);
  });
});

describe("DAB positivity parity with ml/karyon_ml/stain.py", () => {
  it("matches the Python nuclear-minus-perinuclear score", async () => {
    const { deconvolve, M_HDAB } = await import("@/lib/pathology/stain");
    const { measureNuclei } = await import("@/lib/pathology/features");
    const meta = JSON.parse(readFileSync(join(FIX, "positivity.json"), "utf8"));
    const rgb = readFileSync(join(FIX, "positivity.rgb.bin"));
    const l = readFileSync(join(FIX, "positivity.labels.bin"));
    const labels = new Int32Array(l.buffer, l.byteOffset, l.byteLength / 4);
    const n = meta.width * meta.height;
    const data = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
      data[p * 4] = rgb[p * 3];
      data[p * 4 + 1] = rgb[p * 3 + 1];
      data[p * 4 + 2] = rgb[p * 3 + 2];
      data[p * 4 + 3] = 255;
    }
    const [h, dab] = deconvolve({ width: meta.width, height: meta.height, data }, M_HDAB);
    const { nuclei } = measureNuclei(labels, meta.count, meta.width, meta.height, h, dab, 0.5);
    expect(nuclei).toHaveLength(meta.count);
    nuclei.forEach((x, i) => expect(x.contrastS2).toBeCloseTo(meta.score[i], 4));
  });
});
