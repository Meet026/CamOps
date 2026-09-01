"""
Tests for src/pipeline.py — the orchestration logic (detect -> embed ->
store), using fake/mock detector, embedder, and store objects rather than
real ones, so this test file verifies the WIRING and error-handling logic
specifically (does one bad detection skip-and-continue correctly?), not
the real detector/embedder/database behavior — those are covered in
their own dedicated test files.
"""
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid"))
from pipeline import run_pipeline, PipelineResult
from detector import VehicleDetection, DetectorError
from sighting_store import SightingStoreError
from src.embedder import EmbedderError


class FakeDetector:
    """Returns a scripted sequence of detection results per call, or raises."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def detect(self, image_path):
        self.calls.append(image_path)
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeEmbedder:
    def __init__(self, should_fail=False):
        self.input_height = 224
        self.input_width = 224
        self.should_fail = should_fail

    def embed(self, model_input):
        if self.should_fail:
            raise EmbedderError("MODEL_INPUT_SHAPE_MISMATCH", "fake failure")
        vec = np.random.rand(512).astype(np.float32)
        return vec / np.linalg.norm(vec)


class FakeStore:
    def __init__(self, should_fail=False):
        self.saved = []
        self.should_fail = should_fail

    def save(self, sighting):
        if self.should_fail:
            raise SightingStoreError("INSERT_FAILED", "fake failure")
        new_id = f"fake-id-{len(self.saved)}"
        self.saved.append(sighting)
        return new_id


def _fake_detection(class_name="car"):
    crop = Image.fromarray((np.random.rand(50, 50, 3) * 255).astype(np.uint8))
    return VehicleDetection(crop=crop, class_name=class_name, confidence=0.9, box_xyxy=(0, 0, 50, 50))


def test_happy_path_saves_every_detection():
    detector = FakeDetector([[_fake_detection(), _fake_detection()]])
    embedder = FakeEmbedder()
    store = FakeStore()

    result = run_pipeline(["/fake/image1.jpg"], "camera-1", detector, embedder, store)

    assert len(result.saved_sighting_ids) == 2
    assert len(result.skipped) == 0


def test_image_with_no_vehicles_is_skipped_not_error():
    detector = FakeDetector([[]])  # no detections
    embedder = FakeEmbedder()
    store = FakeStore()

    result = run_pipeline(["/fake/empty.jpg"], "camera-1", detector, embedder, store)

    assert len(result.saved_sighting_ids) == 0
    assert len(result.skipped) == 1
    assert result.skipped[0][1] == "NO_VEHICLES_DETECTED"


def test_detector_failure_on_one_image_does_not_stop_the_batch():
    detector = FakeDetector([
        DetectorError("INFERENCE_FAILED", "fake"),
        [_fake_detection()],
    ])
    embedder = FakeEmbedder()
    store = FakeStore()

    result = run_pipeline(
        ["/fake/bad.jpg", "/fake/good.jpg"], "camera-1", detector, embedder, store
    )

    assert len(result.saved_sighting_ids) == 1
    assert len(result.skipped) == 1
    assert "DETECTION_FAILED" in result.skipped[0][1]


def test_embedder_failure_on_one_detection_does_not_stop_others():
    detector = FakeDetector([[_fake_detection(), _fake_detection()]])
    embedder = FakeEmbedder(should_fail=True)
    store = FakeStore()

    result = run_pipeline(["/fake/image.jpg"], "camera-1", detector, embedder, store)

    assert len(result.saved_sighting_ids) == 0
    assert len(result.skipped) == 2
    assert all("EMBEDDING_FAILED" in reason for _, reason in result.skipped)


def test_store_failure_is_recorded_not_raised():
    detector = FakeDetector([[_fake_detection()]])
    embedder = FakeEmbedder()
    store = FakeStore(should_fail=True)

    result = run_pipeline(["/fake/image.jpg"], "camera-1", detector, embedder, store)

    assert len(result.saved_sighting_ids) == 0
    assert len(result.skipped) == 1
    assert "STORE_FAILED" in result.skipped[0][1]
