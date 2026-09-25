"""Build the reproducible synthetic dataset.

    python scripts/build_dataset.py --out data/synth_v2 --train 2400 --val 200 --test 300
"""

import argparse
import time
from pathlib import Path

from karyon_ml.data import build_split

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/synth_v2")
    ap.add_argument("--train", type=int, default=2400)
    ap.add_argument("--val", type=int, default=200)
    ap.add_argument("--test", type=int, default=300)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--workers", type=int, default=2)
    a = ap.parse_args()
    for split, n in (("val", a.val), ("test", a.test), ("train", a.train)):
        t = time.time()
        p = build_split(Path(a.out), split, n, a.size, a.workers)
        print(f"{split}: {n} tiles -> {p} ({time.time() - t:.0f}s)", flush=True)
