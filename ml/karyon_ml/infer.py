"""Sliding-window inference, mirrored by ``src/lib/pathology/tiling.ts``.

Tiles of ``tile`` pixels are taken with ``overlap`` pixels of overlap and
blended with a separable raised-cosine weight so seams do not show up in the
probability maps. Images smaller than a tile are reflect-padded up to the next
multiple of the network stride.
"""

from __future__ import annotations

import numpy as np
import torch

from .model import KaryonUNet, normalise


def tile_origins(length: int, tile: int, overlap: int) -> list[int]:
    if length <= tile:
        return [0]
    stride = tile - overlap
    pos = list(range(0, length - tile + 1, stride))
    if pos[-1] != length - tile:
        pos.append(length - tile)
    return pos


def blend_weight(tile: int, overlap: int) -> np.ndarray:
    w = np.ones(tile, np.float32)
    if overlap > 0:
        ramp = 0.5 - 0.5 * np.cos(np.pi * (np.arange(overlap) + 0.5) / overlap)
        w[:overlap] = ramp
        w[-overlap:] = ramp[::-1]
    w = np.maximum(w, 1e-3)
    return np.outer(w, w)


def _pad_to(img: np.ndarray, mult: int, min_size: int):
    h, w = img.shape[:2]
    H = max(min_size, int(np.ceil(h / mult) * mult))
    W = max(min_size, int(np.ceil(w / mult) * mult))
    if H == h and W == w:
        return img, (h, w)
    return np.pad(img, ((0, H - h), (0, W - w), (0, 0)), mode="reflect"), (h, w)


@torch.no_grad()
def predict(model: KaryonUNet, img: np.ndarray, tile: int = 256, overlap: int = 32) -> np.ndarray:
    """Return head probabilities (3, H, W) float32 for an RGB uint8 image."""
    model.eval()
    padded, (h0, w0) = _pad_to(img, model.stride, 0)
    H, W = padded.shape[:2]
    t = min(tile, H, W)
    t = (t // model.stride) * model.stride
    ov = overlap if t == tile else min(overlap, t // 4)
    acc = np.zeros((3, H, W), np.float32)
    wsum = np.zeros((H, W), np.float32)
    wt = blend_weight(t, ov)
    for y in tile_origins(H, t, ov):
        for x in tile_origins(W, t, ov):
            patch = torch.from_numpy(np.ascontiguousarray(padded[y : y + t, x : x + t])).permute(2, 0, 1)[None]
            prob = torch.sigmoid(model(normalise(patch)))[0].numpy()
            acc[:, y : y + t, x : x + t] += prob * wt
            wsum[y : y + t, x : x + t] += wt
    return (acc / wsum)[:, :h0, :w0]
