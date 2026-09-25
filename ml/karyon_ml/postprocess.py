"""Instance extraction from the three network heads.

This module is the *reference specification* of the post-processing that the
web app runs in ``src/lib/pathology/postprocess.ts``. Both implementations must
produce bit-identical label maps for identical inputs; ``tests/test_parity``
and the web unit tests enforce this with shared golden fixtures.

Algorithm
---------
1. ``mask    = fg > t_fg``
2. ``markers = mask & dist > t_marker & contour < t_contour``, labelled with
   8-connectivity in raster order; markers smaller than ``min_marker`` pixels
   are discarded.
3. Marker-controlled watershed on the elevation ``floor((1 - dist) * 255)``
   restricted to ``mask``, implemented as a bucketed priority flood with FIFO
   tie breaking and a fixed 4-neighbour visiting order (up, left, right, down).
4. Foreground components that received no marker become instances themselves.
5. Instances smaller than ``min_area`` are removed and ids are made contiguous.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi


@dataclass(frozen=True)
class PostprocessParams:
    t_fg: float = 0.5
    t_marker: float = 0.42
    t_contour: float = 0.5
    min_marker: int = 4
    min_area: int = 12


_N4 = ((-1, 0), (0, -1), (0, 1), (1, 0))
_N8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def label_raster(binary: np.ndarray, start: int = 1) -> tuple[np.ndarray, int]:
    """8-connected component labelling, ids assigned in raster order of first pixel."""
    h, w = binary.shape
    out = np.zeros((h, w), np.int32)
    nxt = start
    b = binary.astype(bool)
    for y in range(h):
        for x in range(w):
            if b[y, x] and out[y, x] == 0:
                out[y, x] = nxt
                q = deque([(y, x)])
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in _N8:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and b[ny, nx] and out[ny, nx] == 0:
                            out[ny, nx] = nxt
                            q.append((ny, nx))
                nxt += 1
    return out, nxt - start


def _remove_small_and_relabel(lab: np.ndarray, min_size: int) -> np.ndarray:
    if lab.max() == 0:
        return lab
    counts = np.bincount(lab.ravel())
    keep = counts >= min_size
    keep[0] = False
    lut = np.zeros(counts.size, np.int32)
    lut[keep] = np.arange(1, keep.sum() + 1)
    return lut[lab]


def _watershed_reference(level: np.ndarray, markers: np.ndarray, mask: np.ndarray) -> np.ndarray:
    h, w = level.shape
    lab = markers.copy()
    buckets: list[deque] = [deque() for _ in range(256)]
    ys, xs = np.nonzero(markers)
    for y, x in zip(ys.tolist(), xs.tolist()):  # raster order
        buckets[int(level[y, x])].append((y, x))
    cur = 0
    while cur < 256:
        if not buckets[cur]:
            cur += 1
            continue
        y, x = buckets[cur].popleft()
        lv = lab[y, x]
        for dy, dx in _N4:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and lab[ny, nx] == 0:
                lab[ny, nx] = lv
                nl = max(int(level[ny, nx]), cur)
                buckets[nl].append((ny, nx))
                # nl >= cur, so the scan pointer never needs to move backwards
    return lab


def instances_from_heads(
    fg: np.ndarray,
    contour: np.ndarray,
    dist: np.ndarray,
    params: PostprocessParams = PostprocessParams(),
    impl: str = "fast",
) -> np.ndarray:
    """Convert head probabilities (H, W) float32 in [0, 1] into an int32 label map.

    ``impl="reference"`` is the pure-Python specification (slow, exact twin of
    the TypeScript code). ``impl="fast"`` uses SciPy / scikit-image primitives
    and is used for large evaluations; it matches the reference to within a
    handful of tie-break pixels.
    """
    mask = fg > params.t_fg
    mk = mask & (dist > params.t_marker) & (contour < params.t_contour)
    level = np.clip(np.floor((1.0 - dist) * 255.0), 0, 255).astype(np.int32)

    if impl == "reference":
        markers, _ = label_raster(mk)
        markers = _remove_small_and_relabel(markers, params.min_marker)
        lab = _watershed_reference(level, markers, mask)
        rest = mask & (lab == 0)
        extra, _ = label_raster(rest, start=int(lab.max()) + 1)
        lab = np.where(rest, extra, lab)
    else:
        from skimage.segmentation import watershed

        markers, _ = ndi.label(mk, structure=np.ones((3, 3)))
        markers = _remove_small_and_relabel(markers, params.min_marker)
        lab = watershed(level, markers=markers, mask=mask, connectivity=1).astype(np.int32)
        rest = mask & (lab == 0)
        extra, n = ndi.label(rest, structure=np.ones((3, 3)))
        lab = np.where(rest, extra + lab.max(), lab)

    return _remove_small_and_relabel(lab, params.min_area)
