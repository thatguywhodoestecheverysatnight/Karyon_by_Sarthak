"""Golden fixtures shared by the Python and TypeScript post-processing tests.

Writes tests/fixtures/parity-<name>.json (shape and params) plus two binary
files: float32 heads (3, H, W) and the int32 reference label map (H, W).
The web test suite asserts bit-exact equality with the TypeScript port.
"""

import json
import sys
from pathlib import Path

import numpy as np

from karyon_ml.data import load_split
from karyon_ml.postprocess import PostprocessParams, instances_from_heads
from karyon_ml.synth import generate_tile
from karyon_ml.targets import make_targets

OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def write(name: str, heads: np.ndarray, pp: PostprocessParams):
    heads = np.ascontiguousarray(heads.astype(np.float32))
    lab = instances_from_heads(heads[0], heads[1], heads[2], pp, impl="reference").astype(np.int32)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"parity-{name}.heads.bin").write_bytes(heads.tobytes())
    (OUT / f"parity-{name}.labels.bin").write_bytes(lab.tobytes())
    meta = {"height": int(heads.shape[1]), "width": int(heads.shape[2]), "count": int(lab.max()), "params": pp.__dict__}
    (OUT / f"parity-{name}.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(name, meta["width"], meta["height"], meta["count"])


def main():
    rng = np.random.default_rng(0)
    # 1) noisy analytic heads with touching nuclei and values close to every threshold
    _, inst, _ = generate_tile(4, size=160, density=2.0)
    t = make_targets(inst.astype(np.int32)).astype(np.float32)[:, :120, :144] / 255.0
    noisy = np.clip(t + rng.normal(0, 0.04, t.shape), 0, 1)
    noisy[:, ::11, ::7] = np.float32(0.5)  # exact ties at the default thresholds
    write("synthetic", noisy, PostprocessParams())

    # 2) DAB positivity scores (nuclear minus perinuclear ring) on a membranous IHC tile
    from karyon_ml.stain import positivity

    for seed in range(500, 700):
        img, inst, _ = generate_tile(seed, size=128, mode="ihc")
        if inst.max() >= 15:
            break
    inst = inst.astype(np.int32)
    score, _ = positivity(img, inst, 0.0)
    (OUT / "positivity.rgb.bin").write_bytes(np.ascontiguousarray(img).tobytes())
    (OUT / "positivity.labels.bin").write_bytes(inst.tobytes())
    (OUT / "positivity.json").write_text(json.dumps({"width": 128, "height": 128, "count": int(inst.max()), "score": [float(v) for v in score]}) + "\n")
    print("positivity", seed, int(inst.max()))

    # 3) real model output on a held-out tile, when a checkpoint is given
    if len(sys.argv) > 1:
        from karyon_ml.export_onnx import load
        from karyon_ml.infer import predict

        net = load(sys.argv[1])
        test, _ = load_split(Path("data/synth_v2"), "test")
        card = Path(__file__).resolve().parents[2] / "src" / "data" / "model-card.json"
        pp = PostprocessParams(**json.loads(card.read_text())["postprocess"])
        # first held-out tile whose crop holds a realistic number of nuclei (IHC preferred)
        for i in range(len(test["images"])):
            if test["modes"][i] != "ihc" or len(np.unique(test["inst"][i][:112, :176])) < 25:
                continue
            write("model", predict(net, test["images"][i][:112, :176]), pp)
            break


if __name__ == "__main__":
    main()
