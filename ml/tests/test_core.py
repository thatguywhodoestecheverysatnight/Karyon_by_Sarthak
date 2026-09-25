import numpy as np
import pytest
import torch

from karyon_ml.metrics import aji, dice, panoptic_quality, summarize
from karyon_ml.model import KaryonExport, KaryonUNet
from karyon_ml.postprocess import PostprocessParams, instances_from_heads, label_raster
from karyon_ml.stain import M_HDAB, deconvolve
from karyon_ml.synth import generate_tile
from karyon_ml.targets import make_targets


def two_touching_discs(h=48, w=64):
    yy, xx = np.mgrid[0:h, 0:w]
    inst = np.zeros((h, w), np.int32)
    inst[(yy - 24) ** 2 + (xx - 20) ** 2 <= 100] = 1
    inst[((yy - 24) ** 2 + (xx - 38) ** 2 <= 100) & (inst == 0)] = 2
    return inst


def test_synth_is_deterministic():
    a = generate_tile(123)
    b = generate_tile(123)
    assert np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])
    assert a[0].dtype == np.uint8 and a[0].shape == (256, 256, 3)


def test_synth_ids_are_contiguous():
    _, inst, meta = generate_tile(5)
    ids = np.unique(inst)
    ids = ids[ids > 0]
    assert ids.size > 0
    assert set(meta.positive).issuperset(set(ids.tolist()))


def test_targets_shapes_and_ranges():
    inst = two_touching_discs()
    t = make_targets(inst)
    assert t.shape == (3, 48, 64) and t.dtype == np.uint8
    assert t[0].max() == 255 and t[2].max() == 255
    # the touching seam must be marked as contour
    assert t[1][24, 29] == 255 or t[1][24, 30] == 255


def test_postprocess_splits_touching_nuclei():
    inst = two_touching_discs()
    t = make_targets(inst).astype(np.float32) / 255
    for impl in ("reference", "fast"):
        lab = instances_from_heads(t[0], t[1], t[2], PostprocessParams(), impl=impl)
        assert lab.max() == 2, impl
        assert panoptic_quality(inst, lab).pq > 0.8


def test_reference_and_fast_agree_on_synthetic_heads():
    _, inst, _ = generate_tile(42, size=128)
    t = make_targets(inst.astype(np.int32)).astype(np.float32) / 255
    rng = np.random.default_rng(0)
    noisy = np.clip(t + rng.normal(0, 0.05, t.shape), 0, 1).astype(np.float32)
    a = instances_from_heads(*noisy, impl="reference")
    b = instances_from_heads(*noisy, impl="fast")
    assert a.max() == b.max()
    assert (a != b).mean() < 0.01


def test_label_raster_order():
    b = np.zeros((5, 5), bool)
    b[0, 4] = True
    b[2, 0] = True
    lab, n = label_raster(b)
    assert n == 2 and lab[0, 4] == 1 and lab[2, 0] == 2


def test_metrics_perfect_and_empty():
    inst = two_touching_discs()
    assert dice(inst, inst) == 1.0
    assert aji(inst, inst) == pytest.approx(1.0)
    assert panoptic_quality(inst, inst).pq == pytest.approx(1.0)
    z = np.zeros_like(inst)
    assert panoptic_quality(inst, z).pq == 0.0
    assert aji(z, z) == 1.0
    s = summarize([inst, z], [inst, z])
    assert s["pq"] == pytest.approx(1.0)


def test_metrics_penalise_merges():
    inst = two_touching_discs()
    merged = (inst > 0).astype(np.int32)
    assert panoptic_quality(inst, merged).pq < 0.5
    assert aji(inst, merged) < 0.6


def test_model_shapes_and_export_wrapper():
    net = KaryonUNet((8, 16, 16, 16, 16)).eval()
    x = torch.rand(2, 3, 64, 96) * 255
    y = KaryonExport(net)(x)
    assert y.shape == (2, 3, 64, 96)
    assert float(y.min()) >= 0 and float(y.max()) <= 1


def test_deconvolution_recovers_pure_dab():
    od = 0.8 * M_HDAB[1]
    rgb = (np.exp(-od) * 256 - 1).clip(0, 255).reshape(1, 1, 3)
    c = deconvolve(rgb.astype(np.float32), M_HDAB)[0, 0]
    assert c[1] == pytest.approx(0.8, abs=0.02)
    assert abs(c[0]) < 0.02


def test_onnx_export_parity(tmp_path):
    ort = pytest.importorskip("onnxruntime")
    from karyon_ml.export_onnx import export, verify

    net = KaryonUNet((8, 16, 16, 16, 16)).eval()
    p = tmp_path / "m.onnx"
    export(net, p)
    assert verify(net, p) < 1e-4
    sess = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
    out = sess.run(None, {"rgb": np.zeros((1, 3, 48, 80), np.float32)})[0]
    assert out.shape == (1, 3, 48, 80)


def test_committed_parity_fixtures_match_reference():
    import json
    from pathlib import Path

    fix = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
    for meta_path in sorted(fix.glob("parity-*.json")):
        meta = json.loads(meta_path.read_text())
        name = meta_path.name[: -len(".json")]
        h, w = meta["height"], meta["width"]
        heads = np.frombuffer((fix / f"{name}.heads.bin").read_bytes(), np.float32).reshape(3, h, w)
        want = np.frombuffer((fix / f"{name}.labels.bin").read_bytes(), np.int32).reshape(h, w)
        got = instances_from_heads(heads[0], heads[1], heads[2], PostprocessParams(**meta["params"]), impl="reference")
        assert np.array_equal(got, want), name


def test_folder_dataset_resamples_to_model_resolution(tmp_path):
    from PIL import Image

    from karyon_ml.data import FolderDataset, MixedDataset, TileDataset

    (tmp_path / "images").mkdir()
    (tmp_path / "masks").mkdir()
    img, inst, _ = generate_tile(3, size=256)
    Image.fromarray(img).save(tmp_path / "images" / "a.png")
    Image.fromarray(inst.astype(np.uint16)).save(tmp_path / "masks" / "a.png")
    ds = FolderDataset(tmp_path, crop=64, mpp=0.25)
    assert ds.images[0].shape[:2] == (128, 128)  # 0.25 um/px -> 0.5 um/px halves the size
    x, y = ds[0]
    assert x.shape == (3, 64, 64) and y.shape == (3, 64, 64)
    syn = TileDataset(img[None], make_targets(inst.astype(np.int32))[None], crop=64, length=10)
    mixed = MixedDataset(syn, ds, 0.5, 20)
    assert len(mixed) == 20 and mixed[3][0].shape == (3, 64, 64)
