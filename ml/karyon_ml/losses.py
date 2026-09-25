"""Multi-task loss for the foreground / contour / distance heads."""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F
from monai.losses import DiceLoss


class KaryonLoss(nn.Module):
    def __init__(self, w_fg: float = 1.0, w_contour: float = 1.0, w_dist: float = 2.0, contour_pos_weight: float = 3.0):
        super().__init__()
        self.w = (w_fg, w_contour, w_dist)
        self.dice = DiceLoss(sigmoid=True, smooth_nr=1.0, smooth_dr=1.0, batch=True)
        self.register_buffer("pos_w", torch.tensor([contour_pos_weight]))

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> tuple[torch.Tensor, dict[str, float]]:
        lf, lc, ld = logits[:, 0:1], logits[:, 1:2], logits[:, 2:3]
        tf, tc, td = target[:, 0:1], target[:, 1:2], target[:, 2:3]
        l_fg = F.binary_cross_entropy_with_logits(lf, tf) + self.dice(lf, tf)
        l_ct = F.binary_cross_entropy_with_logits(lc, tc, pos_weight=self.pos_w) + self.dice(lc, tc)
        pd = torch.sigmoid(ld)
        # distance regression, emphasised inside nuclei where it drives the markers
        wmap = 1.0 + 4.0 * tf
        l_d = (wmap * (pd - td) ** 2).sum() / wmap.sum()
        total = self.w[0] * l_fg + self.w[1] * l_ct + self.w[2] * l_d
        return total, {"fg": l_fg.item(), "contour": l_ct.item(), "dist": l_d.item()}
