import { describe, expect, it } from "vitest";
import { classicalSegment } from "@/lib/pathology/classical";
import { measureNuclei, traceBoundary, traceCrack } from "@/lib/pathology/features";
import { createRGBA, percentile, resize } from "@/lib/pathology/image";
import { edt, fillHoles, gaussianBlur, otsu } from "@/lib/pathology/morphology";
import { deconvolve, detectStain, eigSym3, estimateHematoxylin, invert3, M_HDAB, M_HE, macenkoFit, STAIN_E, STAIN_H, type Vec3 } from "@/lib/pathology/stain";
import { blendWeight, planTiles, runTiled, tileOrigins } from "@/lib/pathology/tiling";

function paint(w: number, h: number, fn: (x: number, y: number) => [number, number, number]) {
  const img = createRGBA(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const q = (y * w + x) * 4;
      img.data[q] = r;
      img.data[q + 1] = g;
      img.data[q + 2] = b;
      img.data[q + 3] = 255;
    }
  return img;
}

const odToRgb = (c1: number, v1: Vec3, c2: number, v2: Vec3): [number, number, number] => {
  const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2);
  return [0, 1, 2].map((k) => Math.round(256 * Math.exp(-(c1 * v1[k] / n1 + c2 * v2[k] / n2)) - 1)) as [number, number, number];
};

describe("stain", () => {
  it("inverts stain matrices", () => {
    const inv = invert3(M_HE);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += M_HE[i][k] * inv[k][j];
        expect(s).toBeCloseTo(i === j ? 1 : 0, 6);
      }
  });

  it("recovers known H and E concentrations", () => {
    const img = paint(4, 1, (x) => odToRgb(0.3 + 0.2 * x, STAIN_H, 0.4, STAIN_E));
    const [h, e] = deconvolve(img, M_HE);
    for (let x = 0; x < 4; x++) {
      expect(h[x]).toBeCloseTo(0.3 + 0.2 * x, 1);
      expect(e[x]).toBeCloseTo(0.4, 1);
    }
  });

  it("detects H&E versus H-DAB", () => {
    const he = paint(32, 32, (x) => (x < 16 ? odToRgb(0.9, STAIN_H, 0.1, STAIN_E) : odToRgb(0.05, STAIN_H, 0.9, STAIN_E)));
    expect(detectStain(he).kind).toBe("he");
    const [, dabVec] = [M_HDAB[0], M_HDAB[1]];
    const ihc = paint(32, 32, (x) => (x < 16 ? odToRgb(0.9, STAIN_H, 0, STAIN_E) : odToRgb(0.1, STAIN_H, 1.0, dabVec)));
    expect(detectStain(ihc).kind).toBe("ihc");
  });

  it("estimates a bluer counterstain from nuclear pixels", () => {
    const blueH: Vec3 = [0.64, 0.61, 0.47];
    const img = paint(40, 40, (x) => (x < 20 ? odToRgb(0.9, blueH, 0, STAIN_E) : [250, 250, 250]));
    const labels = new Int32Array(40 * 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) labels[y * 40 + x] = 1;
    const est = estimateHematoxylin(img, labels)!;
    const n = Math.hypot(...blueH);
    const cos = (est[0] * blueH[0] + est[1] * blueH[1] + est[2] * blueH[2]) / n;
    expect(cos).toBeGreaterThan(0.999);
  });

  it("Jacobi eigen decomposition is correct on a diagonalisable matrix", () => {
    const { values } = eigSym3([
      [4, 1, 0],
      [1, 3, 0],
      [0, 0, 1],
    ]);
    expect(values[0]).toBeCloseTo((7 + Math.sqrt(5)) / 2, 6);
    expect(values[2]).toBeCloseTo(1, 6);
  });

  it("Macenko recovers the stain vectors that generated an image", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const img = paint(128, 128, () => odToRgb(rand() * 1.2, STAIN_H, rand() * 0.8, STAIN_E));
    const fit = macenkoFit(img)!;
    const cos = (a: Vec3, b: Vec3) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    expect(cos(fit.stains[0], STAIN_H)).toBeGreaterThan(0.98);
    expect(cos(fit.stains[1], STAIN_E)).toBeGreaterThan(0.98);
  });
});

describe("morphology", () => {
  it("EDT matches brute force", () => {
    const w = 23, h = 17;
    const m = new Uint8Array(w * h);
    let s = 7;
    for (let i = 0; i < m.length; i++) m[i] = (s = (s * 48271) % 2147483647) % 5 !== 0 ? 1 : 0;
    const d = edt(m, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = Infinity;
        if (m[y * w + x])
          for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (!m[yy * w + xx]) best = Math.min(best, Math.hypot(x - xx, y - yy));
        expect(d[y * w + x]).toBeCloseTo(m[y * w + x] ? best : 0, 4);
      }
  });

  it("Otsu separates a bimodal sample", () => {
    const v = new Float32Array(200);
    for (let i = 0; i < 200; i++) v[i] = i < 100 ? 0.1 + (i % 10) * 0.005 : 0.8 + (i % 10) * 0.005;
    const t = otsu(v);
    expect(t).toBeGreaterThanOrEqual(0.145);
    expect(t).toBeLessThan(0.8);
  });

  it("fills enclosed holes only", () => {
    const w = 7, h = 7;
    const m = new Uint8Array(w * h);
    for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) m[y * w + x] = y === 1 || y === 5 || x === 1 || x === 5 ? 1 : 0;
    const f = fillHoles(m, w, h);
    expect(f[3 * w + 3]).toBe(1);
    expect(f[0]).toBe(0);
  });

  it("Gaussian blur preserves the mean of a constant field", () => {
    const a = new Float32Array(100).fill(2);
    const b = gaussianBlur(a, 10, 10, 1.5);
    for (const v of b) expect(v).toBeCloseTo(2, 5);
  });
});

describe("tiling", () => {
  it("covers every pixel and blends symmetrically", () => {
    expect(tileOrigins(600, 256, 32)).toEqual([0, 224, 344]);
    expect(tileOrigins(200, 256, 32)).toEqual([0]);
    const w = blendWeight(64, 16);
    expect(w[0]).toBeCloseTo(w[64 * 64 - 1], 8);
    expect(w[32 * 64 + 32]).toBe(1);
    const plan = planTiles(300, 90);
    expect(plan.tile % 16).toBe(0);
    expect(plan.paddedH).toBe(96);
  });

  it("stitches an identity model back to the input", async () => {
    const img = paint(300, 170, (x, y) => [(x * 7) % 256, (y * 5) % 256, (x + y) % 256]);
    const [a, b, c] = await runTiled(img, async (input) => {
      const out = new Float32Array(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input[i] / 255;
      return out;
    });
    for (const p of [0, 1234, 300 * 170 - 1, 169 * 300 + 150]) {
      expect(a[p]).toBeCloseTo(img.data[p * 4] / 255, 4);
      expect(b[p]).toBeCloseTo(img.data[p * 4 + 1] / 255, 4);
      expect(c[p]).toBeCloseTo(img.data[p * 4 + 2] / 255, 4);
    }
  });
});

describe("features", () => {
  it("measures a disc: area, circularity and eccentricity", () => {
    const w = 60, h = 60;
    const labels = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 30, y - 30) <= 12) labels[y * w + x] = 1;
    const z = new Float32Array(w * h);
    const { nuclei, polygons } = measureNuclei(labels, 1, w, h, z, z, 0.5);
    const n = nuclei[0];
    expect(Math.abs(n.areaUm2 / (Math.PI * 144 * 0.25) - 1)).toBeLessThan(0.05);
    expect(n.circularity).toBeGreaterThan(0.9);
    expect(n.eccentricity).toBeLessThan(0.1);
    expect(n.solidity).toBeGreaterThan(0.95);
    expect(polygons.offsets[1] - polygons.offsets[0]).toBeGreaterThan(40);
  });

  it("traces an L-shaped object without revisiting the start early", () => {
    const w = 6, h = 6;
    const l = new Int32Array(w * h);
    for (const [x, y] of [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3]]) l[y * w + x] = 1;
    const pts = traceBoundary(l, w, h, 1, 1, 1, 100);
    expect(pts.length / 2).toBeGreaterThanOrEqual(5);
  });

  it("scores nuclear DAB against the perinuclear ring", () => {
    const w = 60, h = 30;
    const labels = new Int32Array(w * h);
    const dab = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const inA = Math.hypot(x - 15, y - 15) <= 6, inB = Math.hypot(x - 45, y - 15) <= 6;
        if (inA) {
          labels[y * w + x] = 1;
          dab[y * w + x] = 0.8; // Ki-67 style nuclear stain
        } else if (inB) {
          labels[y * w + x] = 2;
          dab[y * w + x] = 0.3; // negative nucleus under cytoplasmic DAB
        } else dab[y * w + x] = x > 30 ? 0.6 : 0; // membranous stain around nucleus 2 only
      }
    const z = new Float32Array(w * h);
    const [a, b] = measureNuclei(labels, 2, w, h, z, dab, 0.5).nuclei;
    expect(a.contrastS2).toBeCloseTo(0.8, 5);
    expect(b.meanS2).toBeCloseTo(0.3, 5);
    expect(b.contrastS2).toBeLessThan(0);
  });

  it("crack outlines enclose exactly the pixel area and split diagonal pinches", () => {
    const w = 8, h = 8;
    const l = new Int32Array(w * h);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3], [4, 4], [5, 4], [4, 5]]) l[y * w + x] = 1;
    const pts = traceCrack(l, w, h, 1, 2, 2, 200);
    let a = 0;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
    }
    expect(Math.abs(a) / 2).toBeCloseTo(7, 1);
    const keys = new Set<string>();
    for (let i = 0; i < n; i++) keys.add(`${pts[2 * i]},${pts[2 * i + 1]}`);
    expect(keys.size).toBe(n); // no repeated vertex, so the ring is simple
  });

  it("an elongated ellipse has high eccentricity", () => {
    const w = 80, h = 40;
    const labels = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - 40) / 30) ** 2 + ((y - 20) / 6) ** 2 <= 1) labels[y * w + x] = 1;
    const z = new Float32Array(w * h);
    const n = measureNuclei(labels, 1, w, h, z, z, 1).nuclei[0];
    expect(n.eccentricity).toBeGreaterThan(0.95);
    expect(Math.abs(n.orientationDeg)).toBeLessThan(2);
  });
});

describe("classical engine", () => {
  it("finds separate dark nuclei on a light background", () => {
    const centres = [
      [20, 20],
      [60, 22],
      [40, 60],
    ];
    const img = paint(80, 80, (x, y) => (centres.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 7) ? odToRgb(1.0, STAIN_H, 0.1, STAIN_E) : odToRgb(0.03, STAIN_H, 0.35, STAIN_E)));
    const { count } = classicalSegment(img, "he");
    expect(count).toBe(3);
  });
});

describe("image utilities", () => {
  it("resizes a constant image to a constant image", () => {
    const img = paint(37, 21, () => [120, 60, 200]);
    const r = resize(img, 17, 50);
    expect(r.width).toBe(17);
    for (let i = 0; i < r.data.length; i += 4) expect([r.data[i], r.data[i + 1], r.data[i + 2]]).toEqual([120, 60, 200]);
  });

  it("percentile interpolates like numpy", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5);
    expect(percentile([5], 99)).toBe(5);
  });
});
