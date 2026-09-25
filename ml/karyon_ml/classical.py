"""Classical baseline: deconvolution + Otsu + distance-transform watershed.

Mirrors the "Classical" engine in the web app so the model card can report an
honest, like-for-like comparison against the learned model.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi
from skimage.filters import threshold_otsu
from skimage.segmentation import watershed

from .stain import M_HDAB, M_HE, deconvolve


def classical_segment(rgb: np.ndarray, mode: str = "he", min_area: int = 12, peak_radius: int = 3) -> np.ndarray:
    M = M_HE if mode == "he" else M_HDAB
    c = deconvolve(rgb, M)
    # nuclei carry hematoxylin, and in IHC also DAB
    sig = c[..., 0] if mode == "he" else c[..., 0] + c[..., 1]
    sig = ndi.gaussian_filter(sig, 1.0)
    if sig.max() - sig.min() < 1e-3:
        return np.zeros(rgb.shape[:2], np.int32)
    mask = sig > threshold_otsu(sig)
    mask = ndi.binary_opening(mask, np.ones((3, 3)))
    mask = ndi.binary_fill_holes(mask)
    dt = ndi.distance_transform_edt(mask)
    dts = ndi.gaussian_filter(dt, 1.0)
    k = 2 * peak_radius + 1
    peaks = (dts == ndi.maximum_filter(dts, size=k)) & (dt >= 2.0)
    markers, _ = ndi.label(peaks, structure=np.ones((3, 3)))
    # same 256-level elevation as the TypeScript engine (src/lib/pathology/classical.ts)
    level = np.clip(np.floor(255 * (1 - dts / max(float(dts.max()), 1e-9))), 0, 255).astype(np.uint8)
    lab = watershed(level, markers=markers, mask=mask, connectivity=1).astype(np.int32)
    counts = np.bincount(lab.ravel())
    keep = counts >= min_area
    keep[0] = False
    lut = np.zeros(counts.size, np.int32)
    lut[keep] = np.arange(1, keep.sum() + 1)
    return lut[lab]
