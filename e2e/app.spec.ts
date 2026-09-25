import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(here, "..", "src", "data", "samples.json"), "utf8")) as { id: string; groundTruth: { nuclei: number } | null }[];
const GT_CARCINOMA = samples.find((s) => s.id === "he-carcinoma")!.groundTruth!.nuclei;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

async function nucleiCount(page: Page) {
  const kpi = page.getByText("Nuclei", { exact: true }).first().locator("xpath=..");
  const txt = (await kpi.locator("div").nth(1).innerText()).replace(/[^\d]/g, "");
  return Number(txt);
}

test("landing page renders, links to the studio and is accessible", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Every nucleus");
  await expect(page.getByRole("link", { name: /Open the Studio/ }).first()).toHaveAttribute("href", "/studio");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  expect(errors).toEqual([]);
});

test("responses are cross-origin isolated with a strict CSP", async ({ page }) => {
  const res = await page.goto("/studio");
  const h = res!.headers();
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(h["content-security-policy"]).toContain("connect-src 'self'");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test("deep engine segments an H&E sample close to ground truth", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/studio?sample=he-carcinoma");
  await expect(page.getByText(/U-Net on (WebGPU|WebAssembly)/)).toBeVisible({ timeout: 90_000 });
  const n = await nucleiCount(page);
  expect(n).toBeGreaterThan(GT_CARCINOMA * 0.8);
  expect(n).toBeLessThan(GT_CARCINOMA * 1.2);
  await page.getByRole("button", { name: "Hematoxylin" }).click();
  await expect(page.getByRole("button", { name: "Hematoxylin" })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("IHC sample reports a positive index and the threshold updates live", async ({ page }) => {
  await page.goto("/studio?sample=ihc-ki67-high");
  const kpi = page.getByText("Positive index").locator("xpath=..");
  await expect(kpi).toBeVisible({ timeout: 90_000 });
  const before = await kpi.locator("div").nth(1).innerText();
  await page.getByLabel("Positivity threshold").fill("0.6");
  await expect(kpi.locator("div").nth(1)).not.toHaveText(before);
});

test("upload, classical engine and CSV export", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("radio", { name: "Classical" }).click();
  await page.getByLabel("Open image file").setInputFiles(join(here, "..", "public", "samples", "he-stroma-til.jpg"));
  await expect(page.getByText(/Classical · /)).toBeVisible({ timeout: 60_000 });
  expect(await nucleiCount(page)).toBeGreaterThan(20);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Nuclei CSV" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe("he-stroma-til.nuclei.csv");
});

test("studio has no serious accessibility violations after an analysis", async ({ page }) => {
  await page.goto("/studio?sample=he-stroma-til");
  await expect(page.getByText(/U-Net on/)).toBeVisible({ timeout: 90_000 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
});

test("model card shows the benchmark table", async ({ page }) => {
  await page.goto("/model");
  await expect(page.getByRole("heading", { name: "Model card" })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Karyon U-Net");
});

test("unknown routes return the 404 page", async ({ page }) => {
  const res = await page.goto("/nope");
  expect(res!.status()).toBe(404);
  await expect(page.getByText("This field of view is empty.")).toBeVisible();
});

test("stain auto-detection matches every sample", async ({ page }) => {
  test.setTimeout(240_000);
  const all = JSON.parse(readFileSync(join(here, "..", "src", "data", "samples.json"), "utf8")) as { id: string; stain: "he" | "ihc" }[];
  for (const s of all) {
    await page.goto(`/studio?sample=${s.id}`);
    await expect(page.getByText(s.stain === "ihc" ? /IHC \(H-DAB\) detected/ : /H&E detected/)).toBeVisible({ timeout: 90_000 });
  }
});

test("counterstain estimation lowers false DAB positives on the real IHC sample", async ({ page }) => {
  const kpi = page.getByText("Positive index").locator("xpath=..");
  const value = async () => Number((await kpi.locator("div").nth(1).innerText()).replace("%", ""));
  await page.goto("/studio?sample=real-ihc-colon");
  await expect(kpi).toBeVisible({ timeout: 90_000 });
  const fixed = await value();
  await page.getByRole("switch", { name: /Estimate counterstain vector/ }).click();
  await page.getByRole("button", { name: /Re-run with new settings/ }).click();
  await expect(page.getByText("Settings changed")).toBeHidden({ timeout: 90_000 });
  const adapted = await value();
  test.info().annotations.push({ type: "positive index", description: `fixed ${fixed}%, adapted ${adapted}%` });
  expect(adapted).toBeLessThan(fixed);
});

test("service worker installs and precaches the Studio", async ({ page }) => {
  await page.goto("/studio");
  const cached = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !reg.active; i++) await new Promise((r) => setTimeout(r, 100));
    for (let i = 0; i < 200; i++) {
      const keys = await caches.keys();
      if (keys.length) {
        const c = await caches.open(keys[0]);
        const n = (await c.keys()).length;
        if (n > 20) return n;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return 0;
  });
  expect(cached).toBeGreaterThan(20);
});
