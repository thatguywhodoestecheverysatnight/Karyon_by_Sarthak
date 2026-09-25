# karyon-ml

PyTorch training, evaluation and ONNX export for the Karyon nucleus segmentation model.

```bash
pip install -e ".[dev]"
python scripts/build_dataset.py --out data/synth_v2        # 2400 / 200 / 300 tiles, deterministic
python -m karyon_ml.train --config configs/unet_s.yaml     # about 2 h on 2 CPU cores, minutes on a GPU
python -m karyon_ml.export_onnx --ckpt runs/unet_s/best.pt --out ../public/models/karyon-nuclei-v1.onnx
python -m karyon_ml.evaluate --ckpt runs/unet_s/best.pt --onnx ../public/models/karyon-nuclei-v1.onnx \
    --card ../src/data/model-card.json
python scripts/make_figures.py --ckpt runs/unet_s/best.pt  # landing page and model card figures
python scripts/make_parity_fixture.py runs/unet_s/best.pt  # golden files for the web parity tests
pytest -q
```

## Modules

| Module | Purpose |
|---|---|
| `synth.py` | Beer-Lambert synthetic H&E and H-DAB tile generator with exact instance labels |
| `targets.py` | foreground, contour and normalised distance targets from instance maps |
| `model.py` | compact multi-head U-Net and the deployment wrapper (normalisation and sigmoid in-graph) |
| `losses.py` | BCE + Dice (MONAI) for foreground and contour, weighted MSE for distance |
| `data.py` | shard building, HED stain augmentation, `FolderDataset` for real data |
| `infer.py` | sliding-window inference, mirrored by `src/lib/pathology/tiling.ts` |
| `postprocess.py` | reference instance extraction, mirrored bit for bit by `postprocess.ts` |
| `metrics.py` | Dice, AJI, PQ (DQ, SQ), detection F1 |
| `stain.py`, `classical.py` | colour deconvolution and the classical baseline |
| `train.py`, `evaluate.py`, `export_onnx.py` | entry points |

## Fine-tuning on real data

Convert any annotated dataset to this layout, with 16-bit instance label images as masks:

```
my_dataset/
  images/  case01.png  case02.png ...
  masks/   case01.png  case02.png ...
```

Then list the folder in the config and train, starting from the released checkpoint `checkpoints/karyon-nuclei-v1.pt`:

```yaml
data:
  root: data/synth_v2
  folders: [{path: /path/to/my_dataset, mpp: 0.25}]   # scan resolution of the dataset
  real_fraction: 0.5                                   # share of real crops per batch
model:
  init_from: checkpoints/karyon-nuclei-v1.pt
```

Datasets that fit this workflow include MoNuSeg, CryoNuSeg, NuInsSeg, PanNuke and Lizard / CoNIC. Check each dataset's licence before using it commercially.

## Design choices

* **Why three heads?** Foreground alone merges touching nuclei. A contour head marks the seams and a distance head gives one clean peak per nucleus. This is the DCAN / HoVer-Net idea in a model small enough for a browser.
* **Why a custom watershed?** The TypeScript port must reproduce the Python result exactly, so both use the same bucketed priority flood with defined tie breaking and float32 rounding. The parity fixture in `tests/fixtures` enforces it.
* **Why EMA weights?** Exponential moving average weights give a smoother and consistently better checkpoint at no inference cost.
