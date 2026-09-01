"""
Tests for src/detector.py. Uses a real YOLO11n model (auto-downloaded by
ultralytics on first use) for the tests that need real detection behavior
— skipped automatically if ultralytics/the model isn't available yet in
this environment, rather than mocked, since the whole point of this
module is verifying real detector behavior end-to-end.
"""
import io
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

ultralytics = pytest.importorskip("ultralytics")
from detector import VehicleDetector, DetectorError, VEHICLE_CLASS_NAMES  # noqa: E402


def _make_blank_image_file(tmp_path, width=200, height=150):
    path = tmp_path / "blank.jpg"
    arr = np.full((height, width, 3), 128, dtype=np.uint8)  # plain gray — no vehicle
    Image.fromarray(arr, mode="RGB").save(path)
    return str(path)


def test_invalid_model_name_raises_typed_error():
    with pytest.raises(DetectorError) as exc_info:
        VehicleDetector(model_name="this_model_does_not_exist_12345.pt")
    assert exc_info.value.reason == "MODEL_LOAD_FAILED"


def test_detect_on_blank_image_returns_empty_list_not_error(tmp_path):
    detector = VehicleDetector()
    blank_path = _make_blank_image_file(tmp_path)

    detections = detector.detect(blank_path)

    assert detections == []  # no vehicles found is valid, not a failure


def test_detect_on_missing_file_raises_typed_error():
    detector = VehicleDetector()
    with pytest.raises(DetectorError) as exc_info:
        detector.detect("/nonexistent/image.jpg")
    assert exc_info.value.reason in ("INFERENCE_FAILED", "IMAGE_LOAD_FAILED")


def test_vehicle_class_names_are_the_expected_coco_set():
    assert VEHICLE_CLASS_NAMES == {"car", "motorcycle", "bus", "truck"}


def test_detector_vehicle_class_ids_resolved_from_model_names():
    detector = VehicleDetector()
    # Every resolved class id must map back to one of our target names —
    # proves the by-NAME lookup (not hardcoded indices) actually works
    # against the real loaded model.
    resolved_names = {detector._model.names[cid] for cid in detector._vehicle_class_ids}
    assert resolved_names == VEHICLE_CLASS_NAMES
