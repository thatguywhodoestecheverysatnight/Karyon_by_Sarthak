"""Compact multi-head U-Net for nucleus instance segmentation.

Design notes
------------
* Plain Conv-BN-ReLU blocks and bilinear upsampling only: every op is supported
  by onnxruntime-web on both the WASM and WebGPU execution providers, and
  BatchNorm folds into the convolutions at export time.
* Three 1x1 heads share the decoder: foreground, contour and normalised
  distance (see ``targets.py``). This is the same decomposition used by
  DCAN / HoVer-Net style models, at a fraction of their size.
* ``KaryonExport`` bakes input normalisation and the sigmoids into the graph so
  the browser only feeds raw RGB in [0, 255].
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

MEAN = 0.5
STD = 0.25


class ConvBlock(nn.Sequential):
    def __init__(self, cin: int, cout: int):
        super().__init__(
            nn.Conv2d(cin, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
        )


class KaryonUNet(nn.Module):
    def __init__(self, channels: tuple[int, ...] = (16, 32, 64, 96, 128), in_ch: int = 3, n_heads: int = 3):
        super().__init__()
        self.channels = channels
        self.enc = nn.ModuleList()
        c_prev = in_ch
        for c in channels:
            self.enc.append(ConvBlock(c_prev, c))
            c_prev = c
        self.dec = nn.ModuleList()
        for c_skip, c_up in zip(reversed(channels[:-1]), reversed(channels[1:])):
            self.dec.append(ConvBlock(c_skip + c_up, c_skip))
        self.head = nn.Conv2d(channels[0], n_heads, 1)

    @property
    def stride(self) -> int:
        return 2 ** (len(self.channels) - 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        skips = []
        for i, blk in enumerate(self.enc):
            if i > 0:
                x = F.max_pool2d(x, 2)
            x = blk(x)
            skips.append(x)
        skips.pop()
        for blk in self.dec:
            s = skips.pop()
            x = F.interpolate(x, scale_factor=2.0, mode="bilinear", align_corners=False)
            x = blk(torch.cat([x, s], 1))
        return self.head(x)


class KaryonExport(nn.Module):
    """Deployment wrapper: raw RGB [0,255] NCHW in, probabilities NCHW out."""

    def __init__(self, net: KaryonUNet):
        super().__init__()
        self.net = net

    def forward(self, rgb: torch.Tensor) -> torch.Tensor:
        x = (rgb / 255.0 - MEAN) / STD
        return torch.sigmoid(self.net(x))


def normalise(rgb_uint8: torch.Tensor) -> torch.Tensor:
    return (rgb_uint8.float() / 255.0 - MEAN) / STD


def count_params(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())
