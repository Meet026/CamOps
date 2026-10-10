"""
Thin wrapper around FastALPR (fast-alpr[onnx]) — mirrors how
detector.py/embedder.py wrap their own models, keeping FastALPR's own
result shape out of pipeline.py/Sighting.

A plate read is one more, independent signal alongside the existing
embedding: a failure here (no plate found, or the OCR stage couldn't
read any characters) is expected and non-fatal — the crop's embedding
is still saved. See docs/superpowers/specs/2026-10-10-plate-reading-design.md.
"""
import os
import re
from dataclasses import dataclass

import numpy as np

# fast-plate-ocr pads fixed-length outputs with this character.
_OCR_PAD_CHAR = "_"

# A stored plate is ranked AHEAD of visual similarity at search time, so a
# misread is worse than no read: it makes search confidently return the
# wrong vehicle. Measured directly: the real model read a clean rendered
# "GJ01AB1234" as "GI11A112" at 0.39 confidence. Provisional, not a
# validated cutoff — configurable so it can be retuned on real data.
DEFAULT_MIN_CONFIDENCE = float(os.environ.get("VEHICLE_INGEST_PLATE_MIN_CONFIDENCE", "0.6"))

_INDIAN_STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ",
    "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP",
    "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK",
    "UP", "WB",
}
# State plates: GJ01AB1234, GJ1A1234, DL3CAF0001, GJ051234.
_STATE_PLATE = re.compile(r"^([A-Z]{2})[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$")
# Bharat series: 22BH1234AA.
_BH_PLATE = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")


def _normalize(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def is_valid_indian_plate(plate: str) -> bool:
    if _BH_PLATE.match(plate):
        return True
    match = _STATE_PLATE.match(plate)
    return bool(match) and match.group(1) in _INDIAN_STATE_CODES


@dataclass(frozen=True)
class PlateReadResult:
    plate_text: str
    confidence: float


def _plate_confidence(confidence) -> float:
    # OcrResult.confidence is `float | list[float]`; the default models
    # report one score per character. A single misread character makes
    # the whole plate wrong, so the plate is only as trustworthy as its
    # weakest character.
    if isinstance(confidence, (list, tuple, np.ndarray)):
        return float(min(confidence)) if len(confidence) else 0.0
    return float(confidence)


def read_plate(
    frame: np.ndarray, alpr, min_confidence: float = DEFAULT_MIN_CONFIDENCE
) -> PlateReadResult | None:
    """
    Runs FastALPR against a single BGR vehicle crop and returns the
    best valid plate, or None. A read is only kept if it is a well-formed
    Indian plate AND meets min_confidence — anything else is discarded
    rather than stored, since a wrong plate is worse than no plate.

    `alpr` is an already-constructed fast_alpr.ALPR instance, passed in
    rather than constructed here — loading FastALPR's models is
    expensive, so it is built once at startup and reused across frames.
    """
    candidates = []
    for result in alpr.predict(frame):
        ocr = result.ocr
        if ocr is None:
            continue
        text = _normalize(ocr.text or "")
        if not text or not is_valid_indian_plate(text):
            continue
        confidence = _plate_confidence(ocr.confidence)
        if confidence < min_confidence:
            continue
        candidates.append(PlateReadResult(plate_text=text, confidence=confidence))

    if not candidates:
        return None
    return max(candidates, key=lambda c: c.confidence)


def make_plate_reader(alpr):
    """
    Adapts read_plate to the pipeline's plate_reader contract: takes the
    PIL RGB crop run_pipeline already has, returns (plate_text,
    confidence) or None. FastALPR.predict documents its input as BGR, so
    the channel order is flipped here — passing RGB straight through
    would feed the plate detector colour-swapped images.
    """
    def _reader(crop):
        bgr = np.ascontiguousarray(np.asarray(crop.convert("RGB"))[:, :, ::-1])
        result = read_plate(bgr, alpr)
        if result is None:
            return None
        return result.plate_text, result.confidence

    return _reader
