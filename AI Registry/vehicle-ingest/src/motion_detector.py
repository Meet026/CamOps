"""
Cheap, model-free motion detection — gates whether a frame is even worth
sending through the real (slow, GPU-hungry) detect+embed pipeline. Part
of the project's roadmap item "smart motion pre-filtering, before a frame
is even sent for analysis" (see docs/roadmap discussion): most frames a
camera produces have nothing new in them (an empty street, a parked
scene, wind moving a tree) — running the full pipeline on every one of
those wastes processing power that matters once hundreds/thousands of
cameras are ingesting continuously. This module answers one narrow
question fast (a few milliseconds, no model inference): did enough of
this frame change since the last one to be worth a real look?

This is NOT the final word on "is there a vehicle here" — it only decides
whether to bother asking YOLO at all. A real vehicle still has to clear
the existing detect+embed+save pipeline afterward; a motion event that
turns out to be wind or a shadow is correctly dropped at that later,
more accurate stage, exactly like today's "YOLO found nothing real"
case already is.
"""
import cv2
import numpy as np

# Fraction of the frame's pixels that must change meaningfully before a
# frame is considered worth a real detection pass. Not a validated
# cutoff — deliberately configurable (see ingest's existing
# ROUTE_SIMILARITY_THRESHOLD-style convention) since the right value
# genuinely depends on each camera's real placement, lighting, and
# typical scene (a camera overlooking a wide intersection vs. a tight
# gate will have very different "how much of the frame does a vehicle
# realistically cover" answers). 2% is a starting default: small enough
# to catch a vehicle entering from a frame edge, large enough to ignore
# ordinary sensor noise and gentle foliage movement.
MOTION_DETECTION_THRESHOLD = 0.02

# Per-pixel grayscale intensity difference (0-255) below which a pixel is
# treated as unchanged — filters ordinary sensor noise/compression
# artifacts between two otherwise-identical frames, so a flat, static
# scene doesn't register as "changed" purely from re-encoding noise.
_PIXEL_DIFF_NOISE_FLOOR = 25


def has_significant_motion(
    frame_a: np.ndarray,
    frame_b: np.ndarray,
    threshold: float = MOTION_DETECTION_THRESHOLD,
) -> bool:
    """
    Compares two frames (as returned by cv2.imread/cv2.VideoCapture —
    BGR, uint8, shape (height, width, 3)) and returns whether the
    fraction of meaningfully-changed pixels meets or exceeds `threshold`.

    Raises ValueError if the two frames aren't the same shape — a real,
    expected failure mode (the camera's resolution changed between
    polls, or one frame is corrupt/partial) that must fail loudly rather
    than silently crop/broadcast and produce a meaningless comparison.
    """
    if frame_a.shape != frame_b.shape:
        raise ValueError(
            f"Cannot compare frames of different shapes: {frame_a.shape} vs {frame_b.shape}"
        )

    gray_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)

    diff = cv2.absdiff(gray_a, gray_b)
    changed_pixel_count = int(np.count_nonzero(diff > _PIXEL_DIFF_NOISE_FLOOR))
    total_pixel_count = diff.size

    changed_fraction = changed_pixel_count / total_pixel_count
    return changed_fraction >= threshold
