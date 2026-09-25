"""Export a checkpoint to ONNX and verify numerical parity with PyTorch.

    python -m karyon_ml.export_onnx --ckpt runs/unet_s/best.pt --out ../public/models/karyon-nuclei-v1.onnx

The exported graph takes ``rgb`` float32 (N, 3, H, W) in [0, 255] with H and W
multiples of 16, and returns ``prob`` float32 (N, 3, H, W): foreground,
contour and normalised distance probabilities.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from .model import KaryonExport, KaryonUNet


def load(ckpt: str) -> KaryonUNet:
    state = torch.load(ckpt, map_location="cpu", weights_only=False)
    net = KaryonUNet(tuple(state["channels"]))
    sd = {k.removeprefix("module."): v for k, v in state["model"].items() if k != "n_averaged"}
    net.load_state_dict(sd)
    return net.eval()


def export(net: KaryonUNet, out: Path, opset: int = 17) -> None:
    wrapper = KaryonExport(net).eval()
    dummy = torch.rand(1, 3, 256, 256) * 255
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        (dummy,),
        str(out),
        input_names=["rgb"],
        output_names=["prob"],
        dynamic_axes={"rgb": {0: "n", 2: "h", 3: "w"}, "prob": {0: "n", 2: "h", 3: "w"}},
        opset_version=opset,
        dynamo=False,
        do_constant_folding=True,
    )


def verify(net: KaryonUNet, path: Path, sizes=((1, 256, 256), (2, 128, 192))) -> float:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    wrapper = KaryonExport(net).eval()
    worst = 0.0
    for n, h, w in sizes:
        x = (torch.rand(n, 3, h, w) * 255).float()
        with torch.no_grad():
            ref = wrapper(x).numpy()
        got = sess.run(["prob"], {"rgb": x.numpy()})[0]
        worst = max(worst, float(np.abs(ref - got).max()))
    return worst


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--opset", type=int, default=17)
    a = ap.parse_args(argv)
    net = load(a.ckpt)
    out = Path(a.out)
    export(net, out, a.opset)
    err = verify(net, out)
    sha = hashlib.sha256(out.read_bytes()).hexdigest()
    info = {"path": out.name, "bytes": out.stat().st_size, "sha256": sha, "max_abs_err_vs_torch": err, "opset": a.opset}
    print(json.dumps(info, indent=2))
    if err > 1e-4:
        raise SystemExit(f"parity check failed: max abs err {err}")
    return info


if __name__ == "__main__":
    main()
