"""
Tests for src/motion_detector.py — the cheap pixel-diff check that gates
whether a frame is worth running through the expensive YOLO+embedding
pipeline at all. Pure function, no filesystem/network/model access, so
no skip gate is needed for any test here.
"""
import numpy as np
import pytest

from src.motion_detector import has_significant_motion, MOTION_DETECTION_THRESHOLD


def _solid_frame(width=100, height=100, value=50):
    return np.full((height, width, 3), value, dtype=np.uint8)


def test_identical_frames_have_no_motion():
    frame = _solid_frame()
    assert has_significant_motion(frame, frame.copy()) is False


def test_frames_differing_everywhere_have_motion():
    # A completely different solid color, every pixel differs by a
    # large margin — this is the clearest possible "real motion" case.
    frame_a = _solid_frame(value=20)
    frame_b = _solid_frame(value=220)
    assert has_significant_motion(frame_a, frame_b) is True


def test_tiny_localized_change_below_threshold_is_not_motion():
    # Real-world basis for this test: a handful of noisy/flickering
    # pixels (sensor noise, a single leaf moving) should NOT trigger the
    # expensive pipeline — only a change big enough to plausibly be a
    # vehicle entering the frame should. Changing well under 1% of the
    # frame's pixels must stay below the default ~2% threshold.
    frame_a = _solid_frame(value=50)
    frame_b = frame_a.copy()
    frame_b[0:2, 0:2] = 220  # 4 pixels out of 10,000 = 0.04%
    assert has_significant_motion(frame_a, frame_b) is False


def test_change_covering_a_plausible_vehicle_area_is_motion():
    # A ~15%-of-frame rectangular block changing is roughly the
    # footprint a vehicle entering frame would plausibly cover — well
    # above the default threshold, must be flagged as real motion.
    frame_a = _solid_frame(width=100, height=100, value=50)
    frame_b = frame_a.copy()
    frame_b[0:40, 0:40] = 220  # 1600 / 10000 = 16%
    assert has_significant_motion(frame_a, frame_b) is True


def test_custom_threshold_is_honored():
    # Proves the threshold is a real, respected parameter — not a
    # hardcoded value with a dead argument (same convention as
    # sighting_store.py's test_filter_respects_custom_max_speed).
    frame_a = _solid_frame(value=50)
    frame_b = frame_a.copy()
    frame_b[0:10, 0:10] = 220  # 100 / 10000 = 1%

    assert has_significant_motion(frame_a, frame_b, threshold=0.02) is False
    assert has_significant_motion(frame_a, frame_b, threshold=0.005) is True


def test_mismatched_frame_shapes_raise_a_clear_error():
    # A real, expected failure mode: the camera's resolution could
    # change between two polls (reconfigured stream, a corrupt partial
    # frame, etc.) — comparing mismatched shapes must fail loudly, not
    # silently broadcast/crop and produce a meaningless result.
    frame_a = _solid_frame(width=100, height=100)
    frame_b = _solid_frame(width=50, height=50)
    with pytest.raises(ValueError):
        has_significant_motion(frame_a, frame_b)


def test_default_threshold_constant_is_a_small_positive_fraction():
    # Sanity-checks the actual shipped default, not just that *some*
    # default exists — catches an accidental 0.2 vs 0.02 typo, etc.
    assert 0 < MOTION_DETECTION_THRESHOLD < 0.1
