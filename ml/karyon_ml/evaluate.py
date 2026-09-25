"""Evaluate a checkpoint on the held-out test split and produce the model card.

    python -m karyon_ml.evaluate --ckpt runs/unet_s/best.pt --data data/synth_v2 \
        --card ../src/data/model-card.json

Steps
-----
1. Post-processing thresholds are tuned on the *validation* split only.
2. Dice / AJI / PQ are reported on the *test* split for the learned model and
   for the classical baseline, overall and per stain (H&E vs IHC).
3. The DAB positivity threshold is calibrated on validation ground truth and
   the resulting Ki-67 style index error is measured on test.
"""

from __future__ import annotations

import argparse
import itertools
import json
import time
from pathlib import Path

import numpy as np
import torch

from .classical import classical_segment
from .data import load_split
from .export_onnx import load
from .infer import predict
from .metrics import panoptic_quality, summarize
from .model import count_params
from .postprocess import PostprocessParams, instances_from_heads
from .stain import positivity


def tune_postprocess(probs, gts) -> PostprocessParams:
    best, best_pq = PostprocessParams(), -1.0
    for t_fg, t_m, t_c in itertools.product((0.4, 0.5, 0.6), (0.36, 0.44, 0.52, 0.6, 0.68, 0.76), (0.4, 0.5, 0.6)):
        pp = PostprocessParams(t_fg=t_fg, t_marker=t_m, t_contour=t_c)
        preds = [instances_from_heads(p[0], p[1], p[2], pp) for p in probs]
        pq = summarize(gts, preds)["pq"]
        if pq > best_pq:
            best, best_pq = pp, pq
    return best


def mean_dab(img, inst):
    """Baseline positivity score: mean nuclear DAB without the perinuclear correction."""
    from .stain import M_HDAB, deconvolve

    dab = deconvolve(img, M_HDAB)[..., 1]
    n = int(inst.max())
    return np.bincount(inst.ravel(), weights=dab.ravel(), minlength=n + 1)[1:] / np.maximum(np.bincount(inst.ravel(), minlength=n + 1)[1:], 1)


def calibrate_dab(images, insts, positives, modes, score_fn=None) -> float:
    score_fn = score_fn or (lambda img, inst: positivity(img, inst, 0.0)[0])
    scores, labels = [], []
    for img, inst, pos, m in zip(images, insts, positives, modes):
        if m != "ihc" or inst.max() == 0:
            continue
        mean = score_fn(img, inst.astype(np.int32))
        lab = np.zeros(int(inst.max()), bool)
        for p in pos:
            if p - 1 < lab.size:
                lab[p - 1] = True
        scores.append(mean)
        labels.append(lab)
    s, y = np.concatenate(scores), np.concatenate(labels)
    best_t, best_bacc = 0.15, 0.0
    for t in np.linspace(-0.2, 1.0, 121):
        pred = s > t
        tpr = (pred & y).sum() / max(y.sum(), 1)
        tnr = (~pred & ~y).sum() / max((~y).sum(), 1)
        bacc = 0.5 * (tpr + tnr)
        if bacc > best_bacc:
            best_t, best_bacc = float(t), float(bacc)
    return round(best_t, 3)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--data", default="data/synth_v2")
    ap.add_argument("--card", default=None)
    ap.add_argument("--onnx", default=None)
    ap.add_argument("--n-val", type=int, default=120)
    a = ap.parse_args(argv)
    torch.set_num_threads(2)
    net = load(a.ckpt)
    root = Path(a.data)
    val, val_pos = load_split(root, "val")
    test, test_pos = load_split(root, "test")

    nv = min(a.n_val, len(val["images"]))
    vprobs = [predict(net, val["images"][i]) for i in range(nv)]
    vgts = [val["inst"][i].astype(np.int32) for i in range(nv)]
    pp = tune_postprocess(vprobs, vgts)
    t_dab = calibrate_dab(val["images"], val["inst"], val_pos, val["modes"])
    t_mean = calibrate_dab(val["images"], val["inst"], val_pos, val["modes"], mean_dab)
    print("tuned", pp, "t_dab", t_dab, flush=True)

    t0 = time.time()
    preds, cls_preds, gts, modes = [], [], [], []
    ki_err, ki_err_cls, ki_err_mean = [], [], []
    for i in range(len(test["images"])):
        img, gt, mode = test["images"][i], test["inst"][i].astype(np.int32), str(test["modes"][i])
        prob = predict(net, img)
        pr = instances_from_heads(prob[0], prob[1], prob[2], pp)
        cl = classical_segment(img, mode)
        preds.append(pr)
        cls_preds.append(cl)
        gts.append(gt)
        modes.append(mode)
        if mode == "ihc" and gt.max() > 0:
            gt_idx = len(test_pos[i]) / gt.max()
            mscore = mean_dab(img, pr)
            ki_err_mean.append(abs(((mscore > t_mean).mean() if mscore.size else 0.0) - gt_idx) * 100)
            for p, bucket in ((pr, ki_err), (cl, ki_err_cls)):
                _, call = positivity(img, p, t_dab)
                idx = call.mean() if call.size else 0.0
                bucket.append(abs(idx - gt_idx) * 100)
    elapsed = time.time() - t0

    def by_mode(pl, m):
        sel = [k for k, mm in enumerate(modes) if mm == m]
        return summarize([gts[k] for k in sel], [pl[k] for k in sel])

    res = {
        "model": {
            "name": "karyon-nuclei-v1",
            "architecture": "U-Net, 5 levels, 3 heads (foreground, contour, distance)",
            "channels": list(net.channels),
            "params": count_params(net),
        },
        "postprocess": pp.__dict__,
        "t_dab": t_dab,
        "test": {
            "n_tiles": len(gts),
            "karyon": {"all": summarize(gts, preds), "he": by_mode(preds, "he"), "ihc": by_mode(preds, "ihc")},
            "classical": {"all": summarize(gts, cls_preds), "he": by_mode(cls_preds, "he"), "ihc": by_mode(cls_preds, "ihc")},
            "ki67_index_mae_pp": {
                "karyon": float(np.mean(ki_err)) if ki_err else None,
                "classical": float(np.mean(ki_err_cls)) if ki_err_cls else None,
                "mean_dab_rule": float(np.mean(ki_err_mean)) if ki_err_mean else None,
                "n_tiles": len(ki_err),
            },
        },
        "eval_seconds": round(elapsed, 1),
    }

    # latency of the deployed graph on this CPU (2 threads), one 256 x 256 tile
    if a.onnx:
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.intra_op_num_threads = 2
        sess = ort.InferenceSession(a.onnx, so, providers=["CPUExecutionProvider"])
        x = (np.random.rand(1, 3, 256, 256) * 255).astype(np.float32)
        for _ in range(3):
            sess.run(None, {"rgb": x})
        ts = []
        for _ in range(20):
            t = time.perf_counter()
            sess.run(None, {"rgb": x})
            ts.append(time.perf_counter() - t)
        res["latency_ms_256_cpu2"] = round(1000 * float(np.median(ts)), 1)
        res["model"]["onnx_bytes"] = Path(a.onnx).stat().st_size

    # per-tile PQ distribution for the report
    res["test"]["karyon"]["pq_p10_p50_p90"] = [float(np.percentile([panoptic_quality(g, p).pq for g, p in zip(gts, preds) if g.max() or p.max()], q)) for q in (10, 50, 90)]

    txt = json.dumps(res, indent=2)
    print(txt)
    out_dir = Path(a.ckpt).parent
    (out_dir / "eval.json").write_text(txt)
    if a.card:
        # merge, so fields written by scripts/finalize_card.py (export, training) survive
        card_path = Path(a.card)
        card_path.parent.mkdir(parents=True, exist_ok=True)
        card = json.loads(card_path.read_text()) if card_path.exists() else {}
        for k, v in res.items():
            if isinstance(v, dict) and isinstance(card.get(k), dict):
                card[k].update(v)
            else:
                card[k] = v
        card_path.write_text(json.dumps(card, indent=2) + "\n")


if __name__ == "__main__":
    main()
