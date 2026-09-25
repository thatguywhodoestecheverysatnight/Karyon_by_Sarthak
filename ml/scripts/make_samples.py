"""Create the sample gallery shipped with the web app (public/samples).

Synthetic samples come from seeds outside every train/val/test range, so they
are genuinely unseen by the model. Ground-truth nucleus counts and positivity
are stored in the manifest so the Studio can show them next to the prediction.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

from karyon_ml.synth import GENERATOR_VERSION, generate_tile

OUT = Path(__file__).resolve().parents[2] / "public" / "samples"
BASE = 30_000_000


def stats(inst, meta):
    n = int(inst.max())
    types = [meta.cell_type[i] for i in range(1, n + 1)]
    pos = sum(meta.positive[i] for i in range(1, n + 1))
    return n, {t: types.count(t) / max(n, 1) for t in ("tumour", "lymphocyte", "fibroblast", "epithelial")}, pos / max(n, 1)


WANT = [
    ("he-carcinoma", "Tumour cell clusters, H&E", "Clusters of pleomorphic nuclei with vesicular chromatin and nucleoli in fibrous stroma.", "he",
     lambda n, t, p: n > 220 and t["tumour"] > 0.6),
    ("he-glands", "Glandular epithelium, H&E", "Glands lined by columnar cells with basal, elongated nuclei around a lumen.", "he",
     lambda n, t, p: n > 150 and t["epithelial"] > 0.4),
    ("he-stroma-til", "Stroma with lymphocytes, H&E", "Collagen-rich stroma with spindle fibroblasts and a lymphocytic infiltrate.", "he",
     lambda n, t, p: 90 < n < 220 and t["lymphocyte"] > 0.35 and t["fibroblast"] > 0.2),
    ("ihc-ki67-high", "Ki-67 high proliferation, IHC", "Nuclear DAB staining in a highly proliferative region, hematoxylin counterstain.", "ihc",
     lambda n, t, p: n > 150 and p > 0.5 and t["epithelial"] < 0.1),
    ("ihc-ki67-low", "Ki-67 low proliferation, IHC", "Mostly negative nuclei with scattered DAB-positive cells.", "ihc",
     lambda n, t, p: n > 120 and 0.05 < p < 0.18),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    seed = BASE
    for key, title, desc, mode, ok in WANT:
        while True:
            seed += 1
            img, inst, meta = generate_tile(seed, size=512, mode=mode)
            n, t, p = stats(inst, meta)
            if ok(n, t, p):
                break
        Image.fromarray(img).save(OUT / f"{key}.jpg", quality=93)
        Image.fromarray(img).resize((160, 160), Image.LANCZOS).save(OUT / f"{key}.thumb.jpg", quality=85)
        manifest.append({
            "id": key, "title": title, "description": desc, "stain": mode, "mpp": 0.5,
            "src": f"/samples/{key}.jpg", "thumb": f"/samples/{key}.thumb.jpg", "width": 512, "height": 512,
            "source": f"Synthetic (Karyon generator v{GENERATOR_VERSION}, seed {seed}, unseen during training)",
            "groundTruth": {"nuclei": n, "positivePct": round(100 * p, 1) if mode == "ihc" else None},
        })
        print(key, seed, n, round(p, 3))

    import skimage.data as skd

    real = skd.immunohistochemistry()
    Image.fromarray(real).save(OUT / "real-ihc-colon.jpg", quality=93)
    Image.fromarray(real).resize((160, 160), Image.LANCZOS).save(OUT / "real-ihc-colon.thumb.jpg", quality=85)
    manifest.append({
        "id": "real-ihc-colon", "title": "Colonic glands, IHC (real)",
        "description": "Real micrograph: membranous and cytoplasmic DAB (FHL2) with hematoxylin-counterstained nuclei. The marker is not nuclear, so few nuclei should score positive. A domain-shift stress test.",
        "stain": "ihc", "mpp": 0.5, "src": "/samples/real-ihc-colon.jpg", "thumb": "/samples/real-ihc-colon.thumb.jpg",
        "width": int(real.shape[1]), "height": int(real.shape[0]),
        "source": "scikit-image sample data (immunohistochemistry), Center for Microscopy and Molecular Imaging; no known copyright restrictions. Resolution unknown, 0.5 µm/px assumed",
        "groundTruth": None,
    })
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
