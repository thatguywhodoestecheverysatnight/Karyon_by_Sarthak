"""Colour deconvolution and Macenko normalisation (reference for ``stain.ts``)."""

from __future__ import annotations

import numpy as np

from .synth import STAIN_DAB, STAIN_E, STAIN_H


def stain_matrix(v1: np.ndarray, v2: np.ndarray) -> np.ndarray:
    """3x3 matrix with rows v1, v2 and their normalised cross product."""
    v1 = v1 / np.linalg.norm(v1)
    v2 = v2 / np.linalg.norm(v2)
    v3 = np.cross(v1, v2)
    v3 = np.abs(v3) / np.linalg.norm(v3)
    return np.stack([v1, v2, v3])


M_HE = stain_matrix(STAIN_H, STAIN_E)
M_HDAB = stain_matrix(STAIN_H, STAIN_DAB)


def rgb_to_od(rgb: np.ndarray) -> np.ndarray:
    return -np.log((rgb.astype(np.float32) + 1.0) / 256.0)


def deconvolve(rgb: np.ndarray, M: np.ndarray) -> np.ndarray:
    """Return stain concentrations (H, W, 3)."""
    od = rgb_to_od(rgb).reshape(-1, 3)
    c = od @ np.linalg.inv(M)
    return c.reshape(rgb.shape[:2] + (3,)).astype(np.float32)


def ring_means(inst: np.ndarray, values: np.ndarray, ring: int = 4) -> np.ndarray:
    """Mean of ``values`` over each nucleus's perinuclear ring.

    The ring holds background pixels within Chebyshev distance ``ring`` of the nucleus; a
    pixel near several nuclei counts for all of them. Mirrors ``measureNuclei`` in
    src/lib/pathology/features.ts. Nuclei without any ring pixel get 0.
    """
    from scipy import ndimage as ndi

    n = int(inst.max())
    out = np.zeros(n, np.float64)
    st = np.ones((2 * ring + 1, 2 * ring + 1), bool)
    H, W = inst.shape
    for i, sl in enumerate(ndi.find_objects(inst), start=1):
        if sl is None:
            continue
        ys = slice(max(sl[0].start - ring, 0), min(sl[0].stop + ring, H))
        xs = slice(max(sl[1].start - ring, 0), min(sl[1].stop + ring, W))
        sub = inst[ys, xs]
        m = ndi.binary_dilation(sub == i, structure=st) & (sub == 0)
        if m.any():
            out[i - 1] = float(values[ys, xs][m].astype(np.float64).mean())
    return out


def positivity(rgb: np.ndarray, inst: np.ndarray, t_dab: float, ring: int = 4, M: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """DAB score per instance (nuclear minus perinuclear DAB) and the boolean positive call.

    Nuclear markers such as Ki-67 give a strongly positive contrast, while membranous or
    cytoplasmic DAB around a negative nucleus gives a contrast near or below zero.
    """
    dab = deconvolve(rgb, M_HDAB if M is None else M)[..., 1]
    n = int(inst.max())
    if n == 0:
        return np.zeros(0), np.zeros(0, bool)
    inside = np.bincount(inst.ravel(), weights=dab.ravel(), minlength=n + 1)[1:] / np.maximum(np.bincount(inst.ravel(), minlength=n + 1)[1:], 1)
    score = inside - ring_means(inst, dab, ring)
    return score, score > t_dab
