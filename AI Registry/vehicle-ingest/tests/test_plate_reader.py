"""
Tests for src/plate_reader.py — a thin wrapper around FastALPR
(fast-alpr[onnx]), mirroring how detector.py/embedder.py wrap their own
models. No real model is loaded here; FastALPR's ALPR.predict() is
monkeypatched so these tests exercise only this wrapper's own logic
(how it maps FastALPR's result shape to this project's
(plate_text, confidence) convention, and how it handles "no plate
found"), not FastALPR's actual OCR accuracy.
"""
import numpy as np
import pytest

from src.plate_reader import read_plate, PlateReadResult


def _fake_frame():
    return np.zeros((100, 100, 3), dtype=np.uint8)


class _FakeOcrResult:
    def __init__(self, text, confidence):
        self.text = text
        self.confidence = confidence


class _FakeAlprResult:
    def __init__(self, text, confidence):
        self.ocr = _FakeOcrResult(text, confidence)


class _FakeAlpr:
    def __init__(self, results):
        self._results = results

    def predict(self, frame):
        return self._results


def test_returns_plate_text_and_confidence_when_a_plate_is_found():
    alpr = _FakeAlpr([_FakeAlprResult("GJ01AB1234", 0.87)])
    result = read_plate(_fake_frame(), alpr=alpr)
    assert result == PlateReadResult(plate_text="GJ01AB1234", confidence=0.87)


def test_returns_none_when_no_plate_detected():
    alpr = _FakeAlpr([])
    result = read_plate(_fake_frame(), alpr=alpr)
    assert result is None


def test_returns_none_when_ocr_text_is_empty():
    # A real, expected FastALPR outcome: the plate region is detected
    # (a box is drawn) but the OCR stage can't read any characters from
    # it (too blurry/angled) -- an empty text string, not an exception.
    alpr = _FakeAlpr([_FakeAlprResult("", 0.0)])
    result = read_plate(_fake_frame(), alpr=alpr)
    assert result is None


class _NoOcrAlprResult:
    def __init__(self):
        self.ocr = None


def test_returns_none_when_ocr_stage_returns_none():
    # FastALPR's BaseOCR.predict contract is `-> OcrResult | None`: a
    # plate box can be found with no OCR result at all.
    alpr = _FakeAlpr([_NoOcrAlprResult()])
    assert read_plate(_fake_frame(), alpr=alpr) is None


def test_skips_results_without_ocr_and_keeps_ones_with_it():
    alpr = _FakeAlpr([_NoOcrAlprResult(), _FakeAlprResult("GJ01AB1234", 0.8)])
    assert read_plate(_fake_frame(), alpr=alpr) == PlateReadResult("GJ01AB1234", 0.8)


def test_per_character_confidence_is_reduced_to_its_weakest_character():
    # OcrResult.confidence is `float | list[float]` — the default
    # fast-plate-ocr models report one score per character. One misread
    # character makes the whole plate wrong, so the plate is only as
    # trustworthy as its weakest character.
    alpr = _FakeAlpr([_FakeAlprResult("GJ01AB1234", [0.99, 0.95, 0.40, 0.98])])
    result = read_plate(_fake_frame(), alpr=alpr, min_confidence=0.0)
    assert result.plate_text == "GJ01AB1234"
    assert result.confidence == 0.40
    assert isinstance(result.confidence, float)


def test_ocr_padding_characters_are_stripped():
    # fast-plate-ocr pads fixed-length outputs with "_" characters.
    alpr = _FakeAlpr([_FakeAlprResult("GJ01AB1234__", 0.9)])
    assert read_plate(_fake_frame(), alpr=alpr).plate_text == "GJ01AB1234"


def test_make_plate_reader_converts_pil_rgb_crop_to_bgr_array():
    # The pipeline hands over a PIL RGB crop; FastALPR.predict documents
    # its input as BGR. A pure-red RGB pixel must arrive as (0, 0, 255).
    from PIL import Image
    from src.plate_reader import make_plate_reader

    received = {}

    class _CapturingAlpr:
        def predict(self, frame):
            received["frame"] = frame
            return [_FakeAlprResult("GJ01AB1234", 0.9)]

    reader = make_plate_reader(_CapturingAlpr())
    crop = Image.new("RGB", (4, 4), (255, 0, 0))

    assert reader(crop) == ("GJ01AB1234", 0.9)
    assert tuple(received["frame"][0, 0]) == (0, 0, 255)


def test_make_plate_reader_returns_none_when_no_plate():
    from PIL import Image
    from src.plate_reader import make_plate_reader

    reader = make_plate_reader(_FakeAlpr([]))
    assert reader(Image.new("RGB", (4, 4))) is None


def test_rejects_text_that_is_not_a_valid_indian_plate():
    # Real misread from the actual FastALPR model on a clean rendered
    # "GJ01AB1234" plate: it returned "GI11A112". "GI" is not an Indian
    # state code and the trailing number has 3 digits, not 4. Storing it
    # would make plate search confidently return the wrong vehicle.
    alpr = _FakeAlpr([_FakeAlprResult("GI11A112", 0.95)])
    assert read_plate(_fake_frame(), alpr=alpr) is None


def test_rejects_low_confidence_reads_even_if_well_formed():
    alpr = _FakeAlpr([_FakeAlprResult("GJ01AB1234", 0.30)])
    assert read_plate(_fake_frame(), alpr=alpr, min_confidence=0.6) is None


def test_accepts_read_exactly_at_the_confidence_threshold():
    alpr = _FakeAlpr([_FakeAlprResult("GJ01AB1234", 0.6)])
    assert read_plate(_fake_frame(), alpr=alpr, min_confidence=0.6) == PlateReadResult("GJ01AB1234", 0.6)


def test_accepts_common_indian_plate_shapes():
    for plate in ["GJ01AB1234", "GJ1A1234", "MH12DE1433", "DL3CAF0001", "GJ051234"]:
        alpr = _FakeAlpr([_FakeAlprResult(plate, 0.9)])
        assert read_plate(_fake_frame(), alpr=alpr) == PlateReadResult(plate, 0.9), plate


def test_accepts_bharat_series_plate():
    alpr = _FakeAlpr([_FakeAlprResult("22BH1234AA", 0.9)])
    assert read_plate(_fake_frame(), alpr=alpr) == PlateReadResult("22BH1234AA", 0.9)


def test_normalizes_separators_and_case_before_validating():
    alpr = _FakeAlpr([_FakeAlprResult("gj-01 ab-1234", 0.9)])
    assert read_plate(_fake_frame(), alpr=alpr) == PlateReadResult("GJ01AB1234", 0.9)


def test_invalid_highest_confidence_read_falls_back_to_a_valid_lower_one():
    alpr = _FakeAlpr([
        _FakeAlprResult("XX00ZZ", 0.99),
        _FakeAlprResult("GJ05CD5678", 0.80),
    ])
    assert read_plate(_fake_frame(), alpr=alpr) == PlateReadResult("GJ05CD5678", 0.80)


def test_picks_the_highest_confidence_result_when_multiple_plates_found():
    # A real, expected scenario: a crop with more than one vehicle/plate
    # visible at its edges. The caller wants the plate for the vehicle
    # this crop was made for, which is the best-guess (highest
    # confidence) detection, not necessarily the first one returned.
    alpr = _FakeAlpr([
        _FakeAlprResult("GJ01AB1234", 0.40),
        _FakeAlprResult("GJ05CD5678", 0.91),
    ])
    result = read_plate(_fake_frame(), alpr=alpr)
    assert result == PlateReadResult(plate_text="GJ05CD5678", confidence=0.91)
