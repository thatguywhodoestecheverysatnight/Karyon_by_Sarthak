"""Merge export and training metadata into the model card produced by evaluate.py.

    python scripts/finalize_card.py --run runs/unet_s --onnx ../public/models/karyon-nuclei-v1.onnx
"""

import argparse
import hashlib
import json
from pathlib import Path

import torch
import yaml

from karyon_ml.export_onnx import load, verify

ROOT = Path(__file__).resolve().parents[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="runs/unet_s")
    ap.add_argument("--onnx", default=str(ROOT / "public" / "models" / "karyon-nuclei-v1.onnx"))
    ap.add_argument("--card", default=str(ROOT / "src" / "data" / "model-card.json"))
    a = ap.parse_args()
    run = Path(a.run)
    card = json.loads(Path(a.card).read_text())
    cfg = yaml.safe_load((run / "config.yaml").read_text())
    log = [json.loads(line) for line in (run / "log.jsonl").read_text().splitlines() if line.strip()]
    state = torch.load(run / "best.pt", map_location="cpu", weights_only=False)
    onnx = Path(a.onnx)
    err = verify(load(str(run / "best.pt")), onnx)
    elapsed = max((r.get("elapsed_s", 0) for r in log), default=0)
    from karyon_ml.data import load_split

    tr, _ = load_split(Path(cfg["data"]["root"]), "train")
    va, _ = load_split(Path(cfg["data"]["root"]), "val")
    card["export"] = {
        "sha256": hashlib.sha256(onnx.read_bytes()).hexdigest(),
        "bytes": onnx.stat().st_size,
        "opset": 17,
        "max_abs_err_vs_torch": err,
    }
    card["model"]["onnx_bytes"] = onnx.stat().st_size
    t = cfg["train"]
    card["training"] = {
        "iters": t["iters"],
        "batch": t["batch"],
        "crop": t["crop"],
        "train_tiles": int(len(tr["images"])),
        "val_tiles": int(len(va["images"])),
        "optimizer": f"AdamW (lr {t['lr']}, wd {t['weight_decay']}), cosine schedule, EMA {t['ema']}",
        "hardware": "2 vCPU, no GPU",
        "hours": round(elapsed / 3600, 1),
        "best_iter": int(state["it"]),
        "generator_version": 2,
    }
    Path(a.card).write_text(json.dumps(card, indent=2) + "\n")
    print(json.dumps({"export": card["export"], "training": card["training"]}, indent=2))


if __name__ == "__main__":
    main()
