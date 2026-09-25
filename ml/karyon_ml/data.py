"""Datasets, augmentation and reproducible synthetic shard building."""

from __future__ import annotations

import json
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from .synth import STAIN_DAB, STAIN_E, STAIN_H, generate_tile
from .targets import make_targets

SPLIT_SEED_OFFSET = {"train": 0, "val": 10_000_000, "test": 20_000_000}

_M = np.stack([STAIN_H, STAIN_E, STAIN_DAB])
_M_INV = np.linalg.inv(_M)


def _gen(args):
    seed, size = args
    img, inst, meta = generate_tile(seed, size=size)
    tgt = make_targets(inst)
    pos = [int(k) for k, v in meta.positive.items() if v]
    return img, inst, tgt, meta.mode, pos


def build_split(out: Path, split: str, n: int, size: int = 256, workers: int = 2) -> Path:
    """Generate ``n`` tiles for ``split`` into a single compressed ``.npz`` shard."""
    out.mkdir(parents=True, exist_ok=True)
    base = SPLIT_SEED_OFFSET[split]
    args = [(base + i, size) for i in range(n)]
    with Pool(workers) as pool:
        res = pool.map(_gen, args, chunksize=16)
    imgs = np.stack([r[0] for r in res])
    inst = np.stack([r[1] for r in res])
    tgts = np.stack([r[2] for r in res])
    modes = np.array([r[3] for r in res])
    path = out / f"{split}.npz"
    np.savez(path, images=imgs, inst=inst, targets=tgts, modes=modes)
    (out / f"{split}_positive.json").write_text(json.dumps([r[4] for r in res]))
    return path


def load_split(root: Path, split: str):
    z = np.load(root / f"{split}.npz")
    pos_path = root / f"{split}_positive.json"
    pos = json.loads(pos_path.read_text()) if pos_path.exists() else None
    return {k: z[k] for k in z.files}, pos


# --------------------------------------------------------------------------- augmentation


def hed_jitter(img: np.ndarray, rng: np.random.Generator, sigma: float = 0.05, bias: float = 0.03) -> np.ndarray:
    """Stain augmentation in HED space (Tellez et al., 2018)."""
    od = -np.log((img.astype(np.float32) + 1.0) / 256.0)
    c = od.reshape(-1, 3) @ _M_INV
    c = c * rng.uniform(1 - sigma * 3, 1 + sigma * 3, 3) + rng.uniform(-bias, bias, 3)
    od2 = (c @ _M).reshape(img.shape)
    out = np.exp(-od2) * 256.0 - 1.0
    return np.clip(out, 0, 255)


def augment(img: np.ndarray, tgt: np.ndarray, rng: np.random.Generator, crop: int):
    h, w = img.shape[:2]
    y = int(rng.integers(0, h - crop + 1))
    x = int(rng.integers(0, w - crop + 1))
    img = img[y : y + crop, x : x + crop]
    tgt = tgt[:, y : y + crop, x : x + crop]
    k = int(rng.integers(0, 4))
    img = np.rot90(img, k, axes=(0, 1))
    tgt = np.rot90(tgt, k, axes=(1, 2))
    if rng.random() < 0.5:
        img = img[:, ::-1]
        tgt = tgt[:, :, ::-1]
    img = img.astype(np.float32)
    if rng.random() < 0.8:
        img = hed_jitter(img, rng)
    if rng.random() < 0.5:  # brightness / contrast / gamma
        img = img * rng.uniform(0.85, 1.15) + rng.uniform(-15, 15)
        img = np.clip(img, 0, 255)
        img = 255.0 * (img / 255.0) ** rng.uniform(0.8, 1.25)
    if rng.random() < 0.2:  # desaturation, scanner colour profiles
        g = img.mean(-1, keepdims=True)
        img = g + (img - g) * rng.uniform(0.5, 1.0)
    return np.ascontiguousarray(np.clip(img, 0, 255), dtype=np.float32), np.ascontiguousarray(tgt)


class TileDataset(Dataset):
    """Random-crop training dataset over a pre-generated shard."""

    def __init__(self, images: np.ndarray, targets: np.ndarray, crop: int = 128, length: int | None = None, seed: int = 0):
        self.images = images
        self.targets = targets
        self.crop = crop
        self.length = length or len(images)
        self.seed = seed
        self.epoch = 0

    def __len__(self) -> int:
        return self.length

    def __getitem__(self, i: int):
        rng = np.random.default_rng((self.seed, self.epoch, i))
        j = int(rng.integers(0, len(self.images)))
        img, tgt = augment(self.images[j], self.targets[j], rng, self.crop)
        x = torch.from_numpy(img).permute(2, 0, 1)  # float32 0..255
        y = torch.from_numpy(tgt.astype(np.float32) / 255.0)
        return x, y


class FolderDataset(Dataset):
    """Real data: ``root/images/*.png`` with matching instance masks in ``root/masks``.

    Masks are 16-bit PNG or TIFF label images (0 = background). Images are
    resampled from their scan resolution ``mpp`` to the model's working
    resolution (0.5 um/px), because the app resamples inputs the same way.
    """

    def __init__(self, root: str | Path, crop: int = 128, seed: int = 0, mpp: float = 0.5, model_mpp: float = 0.5):
        from PIL import Image
        from skimage.io import imread

        root = Path(root)
        files = sorted(p for p in (root / "images").iterdir() if p.suffix.lower() in {".png", ".tif", ".tiff", ".jpg"})
        if not files:
            raise FileNotFoundError(f"no images found in {root / 'images'}")
        self.images, self.targets = [], []
        for f in files:
            m = next((root / "masks" / (f.stem + ext) for ext in (".png", ".tif", ".tiff") if (root / "masks" / (f.stem + ext)).exists()), None)
            if m is None:
                raise FileNotFoundError(f"missing mask for {f.name}")
            img = imread(f)[..., :3]
            inst = imread(m).astype(np.int32)
            f_scale = mpp / model_mpp  # e.g. 0.25 um/px (40x) -> 0.5x
            if abs(f_scale - 1) > 0.02:
                size = (max(crop, round(img.shape[1] * f_scale)), max(crop, round(img.shape[0] * f_scale)))
                img = np.asarray(Image.fromarray(img).resize(size, Image.BILINEAR))
                inst = np.asarray(Image.fromarray(inst).resize(size, Image.NEAREST)).astype(np.int32)
            self.images.append(img)
            self.targets.append(make_targets(inst))
        self.crop = crop
        self.seed = seed
        self.epoch = 0

    def __len__(self) -> int:
        return len(self.images) * 16

    def __getitem__(self, i: int):
        rng = np.random.default_rng((self.seed, self.epoch, i))
        j = i % len(self.images)
        img, tgt = augment(self.images[j], self.targets[j], rng, self.crop)
        return torch.from_numpy(img).permute(2, 0, 1), torch.from_numpy(tgt.astype(np.float32) / 255.0)


class MixedDataset(Dataset):
    """Draws from real data with probability ``real_fraction``, otherwise from synthetic tiles.

    Without this, a few hundred real crops would be swamped by the effectively
    unlimited synthetic stream.
    """

    def __init__(self, synthetic: Dataset, real: Dataset, real_fraction: float, length: int, seed: int = 0):
        self.synthetic, self.real = synthetic, real
        self.real_fraction = real_fraction
        self.length = length
        self.seed = seed

    def __len__(self) -> int:
        return self.length

    def __getitem__(self, i: int):
        rng = np.random.default_rng((self.seed, 7, i))
        if rng.random() < self.real_fraction:
            return self.real[int(rng.integers(0, len(self.real)))]
        return self.synthetic[int(rng.integers(0, len(self.synthetic)))]
