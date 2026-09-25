"""Dense training targets derived from an instance label map.

Three targets are produced, one per network head:

* ``fg``      nucleus foreground (binary)
* ``contour`` one pixel inner boundary of every instance, which is what lets
              the network split touching nuclei
* ``dist``    per-instance Euclidean distance to the boundary, normalised to
              [0, 1] inside each nucleus. Its peaks are the watershed markers.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi


def instance_boundaries(inst: np.ndarray) -> np.ndarray:
    """Pixels of an instance whose 8-neighbourhood contains another label."""
    p = np.pad(inst, 1, mode="edge")
    c = p[1:-1, 1:-1]
    diff = np.zeros(inst.shape, bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            diff |= p[1 + dy : p.shape[0] - 1 + dy, 1 + dx : p.shape[1] - 1 + dx] != c
    return diff & (inst > 0)


def normalised_distance(inst: np.ndarray) -> np.ndarray:
    out = np.zeros(inst.shape, np.float32)
    for i, sl in enumerate(ndi.find_objects(inst), start=1):
        if sl is None:
            continue
        sl = tuple(slice(max(s.start - 1, 0), s.stop + 1) for s in sl)
        m = inst[sl] == i
        d = ndi.distance_transform_edt(m)
        mx = d.max()
        if mx > 0:
            out[sl][m] = (d[m] / mx).astype(np.float32)
    return out


def make_targets(inst: np.ndarray) -> np.ndarray:
    """Return uint8 array (3, H, W): fg, contour, dist (quantised to 0..255)."""
    inst = inst.astype(np.int32)
    fg = (inst > 0).astype(np.uint8) * 255
    contour = instance_boundaries(inst).astype(np.uint8) * 255
    dist = (normalised_distance(inst) * 255).round().astype(np.uint8)
    return np.stack([fg, contour, dist])
