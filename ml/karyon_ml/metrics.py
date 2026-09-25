"""Segmentation metrics used in computational pathology.

* Dice on the binary foreground
* Aggregated Jaccard Index (AJI), Kumar et al., IEEE TMI 2017
* Panoptic Quality (PQ = DQ x SQ), Kirillov et al., CVPR 2019, as used by
  HoVer-Net, PanNuke, Lizard and CoNIC

All functions take int label maps where 0 is background.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _relabel(x: np.ndarray) -> np.ndarray:
    u, inv = np.unique(x, return_inverse=True)
    if u[0] != 0:
        inv = inv + 1
    return inv.reshape(x.shape)


def _overlaps(gt: np.ndarray, pr: np.ndarray):
    gt = _relabel(gt)
    pr = _relabel(pr)
    ng, npred = int(gt.max()), int(pr.max())
    inter = np.bincount(gt.ravel() * (npred + 1) + pr.ravel(), minlength=(ng + 1) * (npred + 1))
    inter = inter.reshape(ng + 1, npred + 1)
    ag = inter.sum(1)
    ap = inter.sum(0)
    inter = inter[1:, 1:]
    ag, ap = ag[1:], ap[1:]
    union = ag[:, None] + ap[None, :] - inter
    return inter, union, ag, ap


def dice(gt: np.ndarray, pr: np.ndarray) -> float:
    g, p = gt > 0, pr > 0
    s = g.sum() + p.sum()
    return 1.0 if s == 0 else float(2 * (g & p).sum() / s)


def aji(gt: np.ndarray, pr: np.ndarray) -> float:
    inter, union, ag, ap = _overlaps(gt, pr)
    if ag.size == 0:
        return 1.0 if ap.size == 0 else 0.0
    if ap.size == 0:
        return 0.0
    iou = inter / np.maximum(union, 1)
    best = iou.argmax(1)
    has = iou.max(1) > 0
    C = float(inter[np.arange(ag.size), best][has].sum())
    U = float(union[np.arange(ag.size), best][has].sum() + ag[~has].sum())
    used = np.zeros(ap.size, bool)
    used[best[has]] = True
    U += float(ap[~used].sum())
    return C / U if U > 0 else 0.0


@dataclass
class PQResult:
    dq: float
    sq: float
    pq: float
    tp: int
    fp: int
    fn: int


def panoptic_quality(gt: np.ndarray, pr: np.ndarray, thr: float = 0.5) -> PQResult:
    inter, union, ag, ap = _overlaps(gt, pr)
    if ag.size == 0 and ap.size == 0:
        return PQResult(1.0, 1.0, 1.0, 0, 0, 0)
    if ag.size == 0 or ap.size == 0:
        return PQResult(0.0, 0.0, 0.0, 0, int(ap.size), int(ag.size))
    iou = inter / np.maximum(union, 1)
    # IoU > 0.5 guarantees a unique matching
    gi, pi = np.nonzero(iou > thr)
    tp = gi.size
    fp = ap.size - tp
    fn = ag.size - tp
    sq = float(iou[gi, pi].mean()) if tp else 0.0
    dq = tp / (tp + 0.5 * fp + 0.5 * fn)
    return PQResult(dq, sq, dq * sq, tp, fp, fn)


def summarize(gts: list[np.ndarray], preds: list[np.ndarray]) -> dict[str, float]:
    d, a, pq, dq, sq = [], [], [], [], []
    tp = fp = fn = 0
    for g, p in zip(gts, preds):
        d.append(dice(g, p))
        if g.max() == 0 and p.max() == 0:
            continue
        a.append(aji(g, p))
        r = panoptic_quality(g, p)
        pq.append(r.pq)
        dq.append(r.dq)
        sq.append(r.sq)
        tp, fp, fn = tp + r.tp, fp + r.fp, fn + r.fn
    f1 = 2 * tp / max(2 * tp + fp + fn, 1)
    return {
        "dice": float(np.mean(d)),
        "aji": float(np.mean(a)) if a else 1.0,
        "pq": float(np.mean(pq)) if pq else 1.0,
        "dq": float(np.mean(dq)) if dq else 1.0,
        "sq": float(np.mean(sq)) if sq else 1.0,
        "f1_det": float(f1),
        "n_images": len(gts),
    }
