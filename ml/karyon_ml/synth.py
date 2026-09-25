"""Physics-based synthetic histology generator.

Tiles are composed in optical-density (OD) space following the Beer-Lambert
law, the same model used by colour deconvolution (Ruifrok & Johnston, 2001):

    I = I0 * exp(-(C_H * v_H + C_E * v_E + C_DAB * v_DAB))

Each stain has a concentration map and a (randomly perturbed) stain vector, so
the generator covers the scanner and lab variability that real models must be
robust to. Nuclei are drawn as Fourier-perturbed ellipses with chromatin
texture, nuclear rims and nucleoli. Red blood cells and debris are added as
unlabelled hard negatives.

The generator is deterministic given a seed, which makes every dataset shard
reproducible.

Version 2 adds glandular epithelium (columnar cells with radially oriented basal
nuclei), membranous / cytoplasmic DAB, DAB overlying negative nuclei, and bounded
occlusion so that no stained nucleus is left unlabelled.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from scipy import ndimage as ndi

GENERATOR_VERSION = 2

Mode = Literal["he", "ihc"]

# Reference stain vectors (Ruifrok & Johnston), rows are unit OD vectors in RGB.
STAIN_H = np.array([0.650, 0.704, 0.286])
STAIN_E = np.array([0.072, 0.990, 0.105])
STAIN_DAB = np.array([0.268, 0.570, 0.776])


@dataclass
class TileMeta:
    mode: Mode
    positive: dict[int, bool] = field(default_factory=dict)
    cell_type: dict[int, str] = field(default_factory=dict)
    scale: float = 1.0


def _unit(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v) + 1e-8)


def _jitter_vector(v: np.ndarray, rng: np.random.Generator, amount: float) -> np.ndarray:
    out = np.clip(v + rng.normal(0.0, amount, 3), 0.01, None)
    return _unit(out)


def smooth_noise(shape: tuple[int, int], sigma: float | tuple[float, float], rng: np.random.Generator) -> np.ndarray:
    """Band-limited Gaussian noise with zero mean and unit variance."""
    n = ndi.gaussian_filter(rng.standard_normal(shape), sigma, mode="wrap")
    return (n - n.mean()) / (n.std() + 1e-8)


def fiber_noise(size: int, rng: np.random.Generator) -> np.ndarray:
    """Oriented, fibrous texture that imitates collagen in stroma."""
    pad = int(size * 1.5)
    base = ndi.gaussian_filter(rng.standard_normal((pad, pad)), (rng.uniform(0.8, 1.6), rng.uniform(3, 8)), mode="wrap")
    # wavy collagen: warp the oriented noise with a smooth displacement field
    warp = smooth_noise((pad, pad), 20, rng) * rng.uniform(2, 7)
    yy, xx = np.mgrid[0:pad, 0:pad].astype(np.float32)
    base = ndi.map_coordinates(base, [yy + warp, xx], order=1, mode="wrap")
    angle = rng.uniform(0, 180)
    rot = ndi.rotate(base, angle, reshape=False, order=1, mode="wrap")
    o = (pad - size) // 2
    out = rot[o : o + size, o : o + size]
    out = (out - out.mean()) / (out.std() + 1e-8)
    iso = smooth_noise((size, size), rng.uniform(1.5, 4), rng)
    w = rng.uniform(0.3, 0.8)
    mix = w * out + (1 - w) * iso
    return mix / (mix.std() + 1e-8)


def _polar_shape(a: float, b: float, irregularity: float, rng: np.random.Generator):
    """Return r(theta) for a Fourier-perturbed ellipse with semi-axes a >= b."""
    ks = np.arange(2, 6)
    amps = rng.normal(0, irregularity, ks.size) / ks
    phases = rng.uniform(0, 2 * np.pi, ks.size)

    def r(theta: np.ndarray) -> np.ndarray:
        ell = (a * b) / np.sqrt((b * np.cos(theta)) ** 2 + (a * np.sin(theta)) ** 2)
        pert = 1.0 + np.sum(amps[:, None] * np.cos(ks[:, None] * theta.ravel()[None, :] + phases[:, None]), axis=0)
        return ell * pert.reshape(theta.shape)

    return r


@dataclass
class NucleusSpec:
    kind: str
    a: float
    b: float
    angle: float
    irregularity: float
    h: float  # hematoxylin concentration
    vesicular: float  # 0 = solid/hyperchromatic, 1 = open chromatin
    nucleoli: int


def _sample_nucleus(kind: str, scale: float, fiber_angle: float, rng: np.random.Generator) -> NucleusSpec:
    if kind == "lymphocyte":
        r = rng.uniform(5.0, 7.5) * scale
        return NucleusSpec(kind, r * rng.uniform(1.0, 1.15), r, rng.uniform(0, np.pi), rng.uniform(0.02, 0.07),
                           rng.uniform(0.95, 1.45), rng.uniform(0.0, 0.2), 0)
    if kind == "fibroblast":
        a = rng.uniform(10, 18) * scale
        b = rng.uniform(2.6, 4.2) * scale
        return NucleusSpec(kind, a, b, fiber_angle + rng.normal(0, 0.25), rng.uniform(0.03, 0.1),
                           rng.uniform(0.75, 1.15), rng.uniform(0.0, 0.3), 0)
    # tumour / epithelial nuclei: large, pleomorphic, often vesicular
    b = rng.uniform(6.5, 13.0) * scale
    a = b * rng.uniform(1.0, 1.7)
    return NucleusSpec(kind, a, b, rng.uniform(0, np.pi), rng.uniform(0.04, 0.16),
                       rng.uniform(0.55, 1.2), rng.uniform(0.2, 1.0), int(rng.integers(0, 3)))


def _raster(spec: NucleusSpec, cx: float, cy: float, size: int, rng: np.random.Generator):
    """Rasterise a nucleus. Returns (y0, x0, alpha, rim) in a local bbox."""
    r_fn = _polar_shape(spec.a, spec.b, spec.irregularity, rng)
    R = int(np.ceil(spec.a * 1.35)) + 2
    y0, y1 = max(0, int(cy) - R), min(size, int(cy) + R + 1)
    x0, x1 = max(0, int(cx) - R), min(size, int(cx) + R + 1)
    if y1 <= y0 or x1 <= x0:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = xx - cx, yy - cy
    ca, sa = np.cos(spec.angle), np.sin(spec.angle)
    u = dx * ca + dy * sa
    v = -dx * sa + dy * ca
    theta = np.arctan2(v, u)
    rr = np.hypot(u, v)
    boundary = r_fn(theta)
    sd = boundary - rr  # signed distance (approx), positive inside
    alpha = np.clip(sd + 0.5, 0.0, 1.0)
    rim = np.exp(-((sd - 1.0) ** 2) / (2 * 1.1**2)) * (sd > -0.5)
    return y0, x0, alpha, rim, (u, v)


def generate_tile(seed: int, size: int = 256, mode: Mode | None = None, density: float | None = None):
    """Generate one tile.

    Returns
    -------
    image : uint8 (H, W, 3) RGB
    inst  : uint16 (H, W) instance labels, 0 = background
    meta  : TileMeta
    """
    rng = np.random.default_rng(seed)
    if mode is None:
        mode = "ihc" if rng.random() < 0.3 else "he"
    scale = float(rng.uniform(0.8, 1.25))
    meta = TileMeta(mode=mode, scale=scale)

    shape = (size, size)
    cH = np.zeros(shape, np.float32)
    cE = np.zeros(shape, np.float32)
    cD = np.zeros(shape, np.float32)
    inst = np.zeros(shape, np.int32)

    # --- tissue architecture (stroma) --------------------------------------------
    white_thr = rng.uniform(0.6, 2.2)  # higher = less white space
    tissue = smooth_noise(shape, rng.uniform(18, 40), rng)
    tissue = np.clip((tissue + white_thr) * 1.8, 0, 1)
    tissue = ndi.gaussian_filter(tissue, 1.5)

    fib = fiber_noise(size, rng)
    fiber_angle = float(rng.uniform(0, np.pi))
    if mode == "he":
        e_base = rng.uniform(0.25, 0.85)
        cE += (e_base * (1 + 0.35 * fib) * tissue).clip(0)
    else:
        cE += (rng.uniform(0.0, 0.06) * (1 + 0.5 * fib) * tissue).clip(0)
    cH += (rng.uniform(0.02, 0.12) * (1 + 0.5 * smooth_noise(shape, 3, rng)) * tissue).clip(0)
    if mode == "ihc":
        cD += (rng.uniform(0.0, 0.08) * (1 + 0.6 * smooth_noise(shape, 6, rng)) * tissue).clip(0)

    # --- glands: columnar epithelium around a lumen ----------------------------------
    # Epithelial cells get cytoplasm (eosin in H&E; membranous / cytoplasmic DAB in some
    # IHC tiles) and radially oriented, basally placed nuclei. This is the context that
    # the stroma-only generator of v1 lacked and that real carcinoma and colon tissue have.
    glands = []
    n_glands = int(rng.choice([0, 1, 1, 2], p=[0.45, 0.3, 0.15, 0.1]))
    membranous = mode == "ihc" and rng.random() < 0.45
    yy_full, xx_full = np.mgrid[0:size, 0:size].astype(np.float32)
    epi_any = np.zeros(shape, np.float32)
    for _ in range(n_glands):
        gx, gy = rng.uniform(-0.2 * size, 1.2 * size, 2)
        R = rng.uniform(0.3, 0.75) * size * scale
        ar = rng.uniform(0.6, 1.0)
        rot = rng.uniform(0, np.pi)
        thick = rng.uniform(0.28, 0.55)  # epithelium as a fraction of the radius
        ca, sa = np.cos(rot), np.sin(rot)
        u = (xx_full - gx) * ca + (yy_full - gy) * sa
        v = (-(xx_full - gx) * sa + (yy_full - gy) * ca) / ar
        warp = 1 + 0.08 * smooth_noise(shape, 25, rng)
        rho = np.hypot(u, v) / R * warp
        theta = np.arctan2(v, u)
        rho_l = 1 - thick
        epi = np.clip((rho - rho_l) * R * 0.5 + 0.5, 0, 1) * np.clip((1 - rho) * R * 0.5 + 0.5, 0, 1)
        lumen = np.clip((rho_l - rho) * R * 0.5 + 0.5, 0, 1)
        glands.append((gx, gy, R, ar, rot, thick))
        # cell membranes: radial boundaries between columnar cells + basal/apical borders
        cell_w = rng.uniform(7.0, 11.0) * scale
        n_cells = max(12, int(2 * np.pi * R * (1 - thick / 2) / cell_w))
        phase = rng.uniform(0, 2 * np.pi)
        sector = (theta + phase) * n_cells / (2 * np.pi)
        d_mem = np.abs(sector - np.round(sector)) * (2 * np.pi * R * rho / n_cells)
        mem = np.exp(-(d_mem**2) / (2 * 0.8**2)) * epi
        mem += np.exp(-(((rho - rho_l) * R) ** 2) / (2 * 1.2**2)) * epi + np.exp(-(((1 - rho) * R) ** 2) / (2 * 1.2**2)) * epi
        cyto_tex = 1 + 0.25 * smooth_noise(shape, 2.0, rng)
        # replace stroma inside the gland
        cE *= 1 - epi
        cE *= 1 - lumen
        cH *= 1 - lumen * rng.uniform(0.6, 1.0)
        cD *= 1 - lumen
        if mode == "he":
            cE += epi * rng.uniform(0.35, 0.9) * cyto_tex + mem * rng.uniform(0.1, 0.4)
            cH += epi * rng.uniform(0.02, 0.1)
        elif membranous:
            cD += epi * rng.uniform(0.35, 1.0) * cyto_tex + mem * rng.uniform(0.3, 0.9)
        else:
            cD += epi * rng.uniform(0.0, 0.08) * cyto_tex
        epi_any = np.maximum(epi_any, np.maximum(epi, lumen))
        glands[-1] = glands[-1] + (n_cells, phase, rho_l)
    tissue = np.maximum(tissue, epi_any)

    chrom = smooth_noise(shape, rng.uniform(0.9, 1.6), rng)
    fine = smooth_noise(shape, 0.6, rng)

    # --- nuclei ----------------------------------------------------------------
    if density is None:
        density = float(rng.choice([0.0, 0.5, 1.0, 1.0, 1.5, 2.0], p=[0.03, 0.17, 0.3, 0.2, 0.2, 0.1]))
    mix = rng.dirichlet([2.0, 1.2, 1.0])  # tumour, lymphocyte, fibroblast
    n_target = int(density * (size / 256) ** 2 * rng.uniform(35, 70) / scale**2)

    n_clusters = int(rng.integers(1, 5))
    centers = rng.uniform(0, size, (n_clusters, 2))
    pos_frac = float(rng.uniform(0.0, 0.85)) if mode == "ihc" else 0.0
    max_overlap = float(rng.uniform(0.05, 0.35))
    cyto_dab = cD.copy()  # DAB already present before nuclei (membranous staining) also covers them

    state = {"next_id": 1}
    area_now: dict[int, int] = {}

    def place(spec: NucleusSpec, cx: float, cy: float, kind: str, positive_prob: float) -> bool:
        r = _raster(spec, cx, cy, size, rng)
        if r is None:
            return False
        y0, x0, alpha, rim, _ = r
        h, w = alpha.shape
        lab = alpha >= 0.5
        if lab.sum() < 10:
            return False
        region = inst[y0 : y0 + h, x0 : x0 + w]
        covered = region[lab]
        if (covered > 0).mean() > max_overlap:
            return False
        # never hide more than 40% of an existing nucleus: occluded nuclei would keep their
        # stain but lose their label, which teaches the network to ignore real nuclei
        if covered.any():
            ids, cnt = np.unique(covered[covered > 0], return_counts=True)
            if any(c > 0.4 * area_now[int(i)] for i, c in zip(ids, cnt)):
                return False
        tex = chrom[y0 : y0 + h, x0 : x0 + w]
        ftex = fine[y0 : y0 + h, x0 : x0 + w]
        body = spec.h * (1.0 - 0.55 * spec.vesicular) * (1 + (0.18 + 0.25 * spec.vesicular) * tex + 0.08 * ftex)
        rim_amp = spec.h * (0.25 + 0.6 * spec.vesicular)
        conc = alpha * body.clip(0.05) + rim * rim_amp * (alpha > 0)
        for _ in range(spec.nucleoli):
            ny = rng.normal(0, spec.b * 0.3)
            nx = rng.normal(0, spec.b * 0.3)
            yy, xx = np.mgrid[0:h, 0:w]
            ccy, ccx = cy - y0 + ny, cx - x0 + nx
            conc += alpha * spec.h * 0.9 * np.exp(-((yy - ccy) ** 2 + (xx - ccx) ** 2) / (2 * (1.0 * scale) ** 2))

        positive = mode == "ihc" and rng.random() < positive_prob
        if mode == "ihc":
            hscale = rng.uniform(0.35, 0.75)
            if positive:
                dab = rng.uniform(0.35, 1.3)
                cD[y0 : y0 + h, x0 : x0 + w] += alpha * dab * (1 + 0.25 * tex).clip(0.2) + rim * dab * 0.3
                hscale *= rng.uniform(0.3, 0.8)
            else:
                # cytoplasmic DAB above and below the nucleus in the section thickness
                cD[y0 : y0 + h, x0 : x0 + w] -= alpha * cyto_dab[y0 : y0 + h, x0 : x0 + w] * rng.uniform(0.4, 0.8)
            conc = conc * hscale
        cH[y0 : y0 + h, x0 : x0 + w] += conc
        if mode == "he" and kind == "tumour":
            halo = ndi.gaussian_filter(alpha, spec.b * 0.6)
            cE[y0 : y0 + h, x0 : x0 + w] += halo * rng.uniform(0.0, 0.35) * (1 - alpha)
        nid = state["next_id"]
        for i in np.unique(covered[covered > 0]):
            area_now[int(i)] -= int((covered == i).sum())
        region[lab] = nid
        area_now[nid] = int(lab.sum())
        meta.positive[nid] = bool(positive)
        meta.cell_type[nid] = kind
        state["next_id"] += 1
        return True

    # epithelial nuclei: one per columnar cell, basal and radially oriented (pseudostratified)
    gland_pos = pos_frac if not membranous else pos_frac * rng.uniform(0.0, 0.5)
    for gx, gy, R, ar, rot, thick, n_cells, phase, rho_l in glands:
        ca, sa = np.cos(rot), np.sin(rot)
        fill = rng.uniform(0.6, 0.95)
        for k in range(n_cells):
            if rng.random() > fill:
                continue
            th = (k + 0.5) * 2 * np.pi / n_cells - phase + rng.normal(0, 0.02)
            rho = 1 - thick * rng.uniform(0.2, 0.55)
            u, v = R * rho * np.cos(th), R * rho * np.sin(th) * ar
            cx = gx + u * ca - v * sa
            cy = gy + u * sa + v * ca
            if not (-10 <= cx < size + 10 and -10 <= cy < size + 10):
                continue
            radial = np.arctan2(u * sa + v * ca, u * ca - v * sa)
            b = rng.uniform(3.2, 5.5) * scale
            a = b * rng.uniform(1.6, 2.8)
            spec = NucleusSpec("epithelial", a, b, float(radial), rng.uniform(0.03, 0.1), rng.uniform(0.6, 1.2), rng.uniform(0.3, 0.9), int(rng.integers(0, 2)))
            place(spec, cx, cy, "epithelial", gland_pos)

    attempts = 0
    placed = 0
    while placed < n_target and attempts < n_target * 6:
        attempts += 1
        kind = str(rng.choice(["tumour", "lymphocyte", "fibroblast"], p=mix))
        if kind == "tumour" and rng.random() < 0.75:
            c = centers[rng.integers(0, n_clusters)]
            cy, cx = c + rng.normal(0, size * rng.uniform(0.08, 0.25), 2)
        else:
            cy, cx = rng.uniform(-4, size + 4, 2)
        if not (-6 <= cx < size + 6 and -6 <= cy < size + 6):
            continue
        iy, ix = int(np.clip(cy, 0, size - 1)), int(np.clip(cx, 0, size - 1))
        if tissue[iy, ix] < 0.3 and rng.random() < 0.9:
            continue
        if epi_any[iy, ix] > 0.5 and rng.random() < 0.97:
            continue  # glands are populated by their own epithelium
        spec = _sample_nucleus(kind, scale, fiber_angle, rng)
        if place(spec, cx, cy, kind, pos_frac):
            placed += 1
    cD = np.clip(cD, 0, None)
    next_id = state["next_id"]

    # --- hard negatives: red blood cells and debris ------------------------------
    n_rbc = int(rng.poisson(rng.choice([0, 3, 12]))) if mode == "he" else int(rng.poisson(1))
    if n_rbc:
        vc = rng.uniform(0, size, 2)
        for _ in range(n_rbc):
            cy, cx = vc + rng.normal(0, size * 0.12, 2)
            rr = rng.uniform(6.0, 8.0) * scale
            spec = NucleusSpec("rbc", rr * 1.05, rr, 0.0, 0.02, 0, 0, 0)
            r = _raster(spec, cx, cy, size, rng)
            if r is None:
                continue
            y0, x0, alpha, rim, (u, v) = r
            h, w = alpha.shape
            pale = 1.0 - 0.35 * np.exp(-(u**2 + v**2) / (2 * (rr * 0.45) ** 2))
            amt = rng.uniform(0.8, 1.6) if mode == "he" else rng.uniform(0.05, 0.2)
            cE[y0 : y0 + h, x0 : x0 + w] += alpha * amt * pale
            if mode == "ihc":
                cD[y0 : y0 + h, x0 : x0 + w] += alpha * rng.uniform(0.0, 0.1)

    n_debris = int(rng.poisson(1.5))
    for _ in range(n_debris):
        cy, cx = rng.uniform(0, size, 2)
        s = rng.uniform(0.6, 1.8)
        yy, xx = np.ogrid[0:size, 0:size]
        spot = np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * s**2)).astype(np.float32)
        cH += spot * rng.uniform(0.2, 0.9)

    # --- relabel: drop instances that were mostly occluded -----------------------
    ids, counts = np.unique(inst, return_counts=True)
    keep = {int(i) for i, c in zip(ids, counts) if i > 0 and c >= 12}
    lut = np.zeros(next_id + 1, np.int32)
    new = 1
    positive, ctype = {}, {}
    for i in sorted(keep):
        lut[i] = new
        positive[new] = meta.positive[i]
        ctype[new] = meta.cell_type[i]
        new += 1
    inst = lut[inst]
    # connected-component sanity: occlusion can split an instance in two, keep largest piece
    inst = _keep_largest_component(inst)
    meta.positive, meta.cell_type = positive, ctype

    # --- optical model -----------------------------------------------------------
    s_amt = 0.06
    vH = _jitter_vector(STAIN_H, rng, s_amt)
    vE = _jitter_vector(STAIN_E, rng, s_amt)
    vD = _jitter_vector(STAIN_DAB, rng, s_amt)
    kH, kE, kD = rng.uniform(0.6, 1.35), rng.uniform(0.6, 1.35), rng.uniform(0.7, 1.3)
    od = (kH * cH)[..., None] * vH + (kE * cE)[..., None] * vE + (kD * cD)[..., None] * vD
    od += rng.uniform(0.0, 0.04)  # glass / mounting medium
    i0 = rng.uniform(225, 255, 3)
    img = i0 * np.exp(-od)

    blur = rng.choice([0.0, 0.4, 0.7, 1.0, 1.4], p=[0.25, 0.3, 0.25, 0.15, 0.05])
    if blur > 0:
        img = ndi.gaussian_filter(img, (blur, blur, 0))
    img += rng.normal(0, rng.uniform(0.5, 4.0), img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)

    if rng.random() < 0.35:
        img = _jpeg(img, int(rng.integers(55, 95)))

    return img, inst.astype(np.uint16), meta


def _keep_largest_component(inst: np.ndarray) -> np.ndarray:
    out = np.zeros_like(inst)
    objs = ndi.find_objects(inst)
    for i, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        m = inst[sl] == i
        lab, n = ndi.label(m, structure=np.ones((3, 3)))
        if n > 1:
            sizes = ndi.sum(m, lab, range(1, n + 1))
            m = lab == (int(np.argmax(sizes)) + 1)
        sub = out[sl]
        sub[m] = i
    # ids stay the same (positive / type dicts remain valid)
    return out


def _jpeg(img: np.ndarray, quality: int) -> np.ndarray:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB"))
