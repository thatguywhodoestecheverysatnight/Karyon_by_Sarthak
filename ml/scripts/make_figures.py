"""Render the figures used on the landing page and model card.

    python scripts/make_figures.py --ckpt runs/unet_s/best.pt
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from karyon_ml.export_onnx import load
from karyon_ml.infer import predict
from karyon_ml.postprocess import PostprocessParams, instances_from_heads
from karyon_ml.synth import generate_tile
from karyon_ml.targets import instance_boundaries

ROOT = Path(__file__).resolve().parents[2]
IMG = ROOT / "public" / "images"

STOPS = [(0, (0, 0, 4)), (0.25, (87, 16, 110)), (0.5, (188, 55, 84)), (0.75, (249, 142, 9)), (1, (252, 255, 164))]


def cmap(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    out = np.zeros(x.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(STOPS[:-1], STOPS[1:]):
        m = (x >= t0) & (x <= t1)
        f = ((x - t0) / (t1 - t0))[m][:, None]
        out[m] = np.array(c0) + (np.array(c1) - np.array(c0)) * f
    return out.astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--before", default=None, help="earlier checkpoint for the iteration-history figure")
    a = ap.parse_args()
    IMG.mkdir(parents=True, exist_ok=True)
    card_path = ROOT / "src" / "data" / "model-card.json"
    pp = PostprocessParams(**json.loads(card_path.read_text())["postprocess"]) if card_path.exists() else PostprocessParams()
    net = load(a.ckpt)

    # hero: carcinoma sample with outlines as a transparent overlay
    hero = np.asarray(Image.open(ROOT / "public" / "samples" / "he-carcinoma.jpg").convert("RGB"))
    prob = predict(net, hero)
    lab = instances_from_heads(prob[0], prob[1], prob[2], pp)
    Image.fromarray(hero).save(IMG / "hero-input.jpg", quality=92)
    b = instance_boundaries(lab)
    ov = np.zeros(hero.shape[:2] + (4,), np.uint8)
    ov[b] = (96, 232, 180, 255)
    Image.fromarray(ov, "RGBA").save(IMG / "hero-overlay.png", optimize=True)
    print("hero nuclei:", lab.max())

    # heads: a 256 crop of the same tile
    crop = hero[128:384, 128:384]
    pc = predict(net, crop)
    Image.fromarray(crop).save(IMG / "heads-input.png", optimize=True)
    for name, k in (("fg", 0), ("contour", 1), ("dist", 2)):
        Image.fromarray(cmap(pc[k])).save(IMG / f"heads-{name}.png", optimize=True)

    # iteration history: earlier checkpoint vs released model on the real IHC micrograph
    if a.before:
        real = np.asarray(Image.open(ROOT / "public" / "samples" / "real-ihc-colon.jpg").convert("RGB"))
        panels = []
        for ck in (a.before, a.ckpt):
            m = load(ck)
            pr = predict(m, real)
            lb = instances_from_heads(pr[0], pr[1], pr[2], pp)
            ov = real.copy()
            ov[instance_boundaries(lb)] = (40, 255, 120)
            panels.append(ov)
            print(ck, "real nuclei:", lb.max())
        gap = np.full((real.shape[0], 8, 3), 255, np.uint8)
        Image.fromarray(np.concatenate([panels[0], gap, panels[1]], 1)).save(IMG / "real-before-after.jpg", quality=88)

    # synthetic data grid for the model card
    tiles = []
    for i, mode in enumerate(["he", "he", "ihc", "he", "ihc", "he", "he", "ihc", "he", "he", "ihc", "he"]):
        img, _, _ = generate_tile(40_000_000 + i, size=256, mode=mode)
        tiles.append(img)
    grid = np.concatenate([np.concatenate(tiles[:6], 1), np.concatenate(tiles[6:], 1)], 0)
    Image.fromarray(grid).save(IMG / "synth-grid.jpg", quality=86)


if __name__ == "__main__":
    main()
