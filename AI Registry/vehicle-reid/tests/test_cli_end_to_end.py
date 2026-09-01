import os
import json
import numpy as np
from PIL import Image
import pytest
from src.cli import run

MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"
)


def _make_fixture_dataset(base_dir):
    """Creates a tiny fake clean/ dataset: 2 vehicles with 2 images each,
    1 vehicle with 1 image, plus one deliberately corrupt file to prove
    the run doesn't crash on bad input."""
    clean_dir = os.path.join(base_dir, "clean")

    for vehicle_id, count in [("v001", 2), ("v002", 2), ("v003", 1)]:
        vehicle_dir = os.path.join(clean_dir, vehicle_id)
        os.makedirs(vehicle_dir, exist_ok=True)
        for i in range(count):
            arr = (np.random.rand(120, 160, 3) * 255).astype(np.uint8)
            Image.fromarray(arr, mode="RGB").save(
                os.path.join(vehicle_dir, f"img_{i}.jpg")
            )

    corrupt_dir = os.path.join(clean_dir, "v004")
    os.makedirs(corrupt_dir, exist_ok=True)
    with open(os.path.join(corrupt_dir, "broken.jpg"), "wb") as f:
        f.write(b"not a real image")

    return clean_dir


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_full_run_produces_report_with_all_expected_sections(tmp_path):
    clean_dir = _make_fixture_dataset(str(tmp_path))
    output_dir = str(tmp_path / "reports")

    md_path, json_path = run(clean_dir, MODEL_PATH, output_dir)

    assert os.path.exists(md_path)
    assert os.path.exists(json_path)

    md_content = open(md_path).read()
    assert "clean" in md_content
    assert "blur" in md_content
    assert "low_light" in md_content
    assert "heavy_crop" in md_content
    assert "tiny_resolution" in md_content
    assert "broken.jpg" in md_content  # the corrupt file must be reported, not silently dropped
    assert "Known Limitations" in md_content

    data = json.load(open(json_path))
    assert "clean" in data["conditions"]
    assert len(data["skipped_files"]) >= 1


@pytest.mark.skipif(not os.path.exists(MODEL_PATH), reason="model not fetched — run scripts/fetch_model.py first")
def test_run_does_not_crash_on_missing_model(tmp_path):
    clean_dir = _make_fixture_dataset(str(tmp_path))
    output_dir = str(tmp_path / "reports")

    with pytest.raises(Exception):
        run(clean_dir, "/nonexistent/model.onnx", output_dir)
