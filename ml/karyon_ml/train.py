"""Training entry point.

    python -m karyon_ml.train --config configs/unet_s.yaml

Logs one JSON object per line to ``<out>/log.jsonl`` and keeps ``last.pt`` and
``best.pt`` (selected on validation PQ). Weights are tracked with an
exponential moving average, which is what gets evaluated and exported.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
import yaml
from torch.optim.swa_utils import AveragedModel, get_ema_multi_avg_fn
from torch.utils.data import DataLoader

from .data import FolderDataset, MixedDataset, TileDataset, load_split
from .infer import predict
from .losses import KaryonLoss
from .metrics import summarize
from .model import KaryonUNet, count_params
from .postprocess import PostprocessParams, instances_from_heads


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def lr_at(it: int, total: int, base: float, warmup: int) -> float:
    if it < warmup:
        return base * (it + 1) / warmup
    p = (it - warmup) / max(1, total - warmup)
    return base * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * p)))


def validate(model, val, n: int, pp: PostprocessParams) -> dict[str, float]:
    gts, preds = [], []
    for i in range(min(n, len(val["images"]))):
        prob = predict(model, val["images"][i])
        preds.append(instances_from_heads(prob[0], prob[1], prob[2], pp))
        gts.append(val["inst"][i].astype(np.int32))
    return summarize(gts, preds)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--iters", type=int, default=None, help="override total iterations")
    args = ap.parse_args(argv)
    cfg = yaml.safe_load(Path(args.config).read_text())
    if args.iters:
        cfg["train"]["iters"] = args.iters

    seed_everything(cfg.get("seed", 0))
    torch.set_num_threads(cfg.get("threads", 2))
    out = Path(cfg["out"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "config.yaml").write_text(yaml.safe_dump(cfg))

    tcfg = cfg["train"]
    data_root = Path(cfg["data"]["root"])
    train, _ = load_split(data_root, "train")
    val, _ = load_split(data_root, "val")
    n_samples = tcfg["iters"] * tcfg["batch"]
    ds = TileDataset(train["images"], train["targets"], crop=tcfg["crop"], length=n_samples, seed=cfg.get("seed", 0))
    folders = cfg["data"].get("folders", []) or []
    if folders:
        # entries are paths or {path, mpp}; real crops are mixed in at a fixed ratio
        real = torch.utils.data.ConcatDataset(
            [FolderDataset(f["path"], crop=tcfg["crop"], mpp=f.get("mpp", 0.5)) if isinstance(f, dict) else FolderDataset(f, crop=tcfg["crop"]) for f in folders]
        )
        ds = MixedDataset(ds, real, cfg["data"].get("real_fraction", 0.5), n_samples, seed=cfg.get("seed", 0))
    dl = DataLoader(ds, batch_size=tcfg["batch"], shuffle=False, num_workers=tcfg.get("workers", 0), drop_last=True)

    model = KaryonUNet(tuple(cfg["model"]["channels"]))
    if cfg["model"].get("init_from"):
        # fine-tuning: start from a released checkpoint, e.g. checkpoints/karyon-nuclei-v1.pt
        state = torch.load(cfg["model"]["init_from"], map_location="cpu", weights_only=False)
        model.load_state_dict({k.removeprefix("module."): v for k, v in state["model"].items() if k != "n_averaged"})
    ema = AveragedModel(model, multi_avg_fn=get_ema_multi_avg_fn(tcfg.get("ema", 0.998)), use_buffers=True)
    crit = KaryonLoss(**cfg.get("loss", {}))
    opt = torch.optim.AdamW(model.parameters(), lr=tcfg["lr"], weight_decay=tcfg["weight_decay"])
    pp = PostprocessParams(**cfg.get("postprocess", {}))
    print(f"params: {count_params(model):,}  train tiles: {len(train['images'])}  val tiles: {len(val['images'])}")

    log = (out / "log.jsonl").open("a")
    best = -1.0
    t0 = time.time()
    it = 0
    run = {"loss": 0.0, "fg": 0.0, "contour": 0.0, "dist": 0.0}
    model.train()
    for x, y in dl:
        if it >= tcfg["iters"]:
            break
        for g in opt.param_groups:
            g["lr"] = lr_at(it, tcfg["iters"], tcfg["lr"], tcfg.get("warmup", 200))
        x = (x / 255.0 - 0.5) / 0.25
        logits = model(x)
        loss, parts = crit(logits, y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        ema.update_parameters(model)
        run["loss"] += loss.item()
        for k, v in parts.items():
            run[k] += v
        it += 1

        if it % tcfg.get("log_every", 50) == 0:
            n = tcfg.get("log_every", 50)
            rec = {"it": it, "lr": opt.param_groups[0]["lr"], "elapsed_s": round(time.time() - t0, 1), **{k: round(v / n, 4) for k, v in run.items()}}
            print(json.dumps(rec), flush=True)
            log.write(json.dumps(rec) + "\n")
            log.flush()
            run = {k: 0.0 for k in run}

        if it % tcfg.get("val_every", 500) == 0 or it == tcfg["iters"]:
            m = validate(ema.module, val, tcfg.get("val_tiles", 64), pp)
            model.train()
            rec = {"it": it, "val": m}
            print(json.dumps(rec), flush=True)
            log.write(json.dumps(rec) + "\n")
            log.flush()
            state = {"model": ema.module.state_dict(), "channels": list(cfg["model"]["channels"]), "it": it, "val": m}
            torch.save(state, out / "last.pt")
            if m["pq"] > best:
                best = m["pq"]
                torch.save(state, out / "best.pt")
    log.close()
    print(f"done. best val PQ {best:.4f}")


if __name__ == "__main__":
    main()
