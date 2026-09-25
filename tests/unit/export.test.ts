import { describe, expect, it } from "vitest";
import { measureNuclei } from "@/lib/pathology/features";
import { summarize, toCSV, toGeoJSON, toReport } from "@/lib/pathology/export";
import type { AnalysisResult } from "@/lib/pathology/types";
import { stem } from "@/lib/download";

function fakeResult(stain: "he" | "ihc"): AnalysisResult {
  const w = 40, h = 20;
  const labels = new Int32Array(w * h);
  const dab = new Float32Array(w * h);
  for (let y = 5; y < 15; y++)
    for (let x = 5; x < 15; x++) {
      labels[y * w + x] = 1;
      dab[y * w + x] = 0.5;
    }
  for (let y = 5; y < 15; y++) for (let x = 25; x < 35; x++) labels[y * w + x] = 2;
  const z = new Float32Array(w * h);
  const { nuclei, polygons } = measureNuclei(labels, 2, w, h, z, dab, 0.5);
  return {
    width: w, height: h, scaleX: 0.5, scaleY: 0.5, workingMpp: 0.5, stain, stainDetected: true, stainVectors: [[0.65, 0.7, 0.29], [0.27, 0.57, 0.78]], engine: "deep", backend: "wasm", tiles: 1,
    labels, count: 2, nuclei, polygons,
    layers: { working: new Uint8ClampedArray(w * h * 4), normalized: null, stain1: new Uint8ClampedArray(0), stain2: new Uint8ClampedArray(0), probability: null },
    timings: { preprocessMs: 1, inferenceMs: 1, postprocessMs: 1, measureMs: 1, totalMs: 4 },
    warnings: [],
  };
}

describe("exports", () => {
  it("summarises positivity and H-score for IHC", () => {
    const s = summarize(fakeResult("ihc"), 0.2);
    expect(s.count).toBe(2);
    expect(s.positive).toBe(1);
    expect(s.positiveIndex).toBe(50);
    // DAB score 0.5 with threshold 0.2: bins at 0.2 / 0.5 / 0.8, so it is "weak" (not above 0.5)
    // H-score = 1 x 50% weak = 50
    expect(s.hScore).toBe(50);
    expect(summarize(fakeResult("ihc"), 0.1).hScore).toBe(100); // 0.5 > 0.4: moderate
    expect(summarize(fakeResult("he"), 0.2).positiveIndex).toBeNull();
  });

  it("writes one CSV row per nucleus in original-image pixels", () => {
    const csv = toCSV(fakeResult("ihc"), 0.2).trim().split("\n");
    expect(csv).toHaveLength(3);
    expect(csv[0]).toContain("dab_positive");
    const cx = Number(csv[1].split(",")[1]);
    expect(cx).toBeCloseTo((9.5 + 0.5) / 0.5, 1); // pixel-corner convention, like QuPath
  });

  it("produces closed GeoJSON polygons that QuPath accepts", () => {
    const g = toGeoJSON(fakeResult("ihc"), 0.2);
    expect(g.features).toHaveLength(2);
    const ring = g.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(g.features[0].properties.classification.name).toBe("Positive");
    expect(g.features[1].properties.classification.name).toBe("Negative");
    // scale 0.5 means original coordinates are twice the working ones
    const xs = ring.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(10); // left edge of pixel 5 at scale 0.5
  });

  it("includes a disclaimer in the report", () => {
    expect(toReport(fakeResult("he"), 0.2, {}).disclaimer).toMatch(/Research use only/);
  });

  it("sanitises download names", () => {
    expect(stem("C:\\slides\\case 12 (A).tiff")).toBe("case_12_A_");
    expect(stem("x.png")).toBe("x");
  });
});
