"""
Candidate Sighting Ranker & Scorer.

Calculates composite match scores for retrieved vehicle sightings by fusing:
- Attribute Similarity (color, vehicle type, make, model)
- Plate Match Score
- Spatial Location Match Score
- Temporal Score
"""

import math
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from ..schemas.search import ParsedQuery, SightingResult


def score_and_rank_sightings(
    candidates: List[Dict[str, Any]],
    parsed: ParsedQuery,
    target_camera_ids: List[str]
) -> List[SightingResult]:
    """Scores candidate sightings and converts them to SightingResult schemas ordered by rank."""
    scored_results: List[SightingResult] = []

    for item in candidates:
        attr_score = _calc_attribute_score(item, parsed)
        plate_score = _calc_plate_score(item, parsed)
        spatial_score = _calc_spatial_score(item, target_camera_ids)
        temporal_score = _calc_temporal_score(item.get("timestamp"), parsed)

        # Composite weighted score
        composite = (
            (attr_score * 0.40) +
            (plate_score * 0.25) +
            (spatial_score * 0.25) +
            (temporal_score * 0.10)
        )

        match_reasons = []
        if attr_score > 0.7:
            match_reasons.append("Attribute Match (Color/Make/Type)")
        if plate_score > 0.8:
            match_reasons.append("Plate Match")
        if spatial_score > 0.8:
            match_reasons.append("Location Proximity Match")
        if temporal_score > 0.8:
            match_reasons.append("Time Window Match")

        lat = float(item["latitude"]) if item.get("latitude") is not None else None
        lon = float(item["longitude"]) if item.get("longitude") is not None else None

        scored_results.append(SightingResult(
            id=str(item["id"]),
            camera_id=str(item.get("camera_id", "CAM-UNKNOWN")),
            camera_name=item.get("camera_name") or str(item.get("camera_id", "Unknown Camera")),
            camera_location=item.get("camera_location"),
            latitude=lat,
            longitude=lon,
            timestamp=item["timestamp"],
            license_plate=item.get("license_plate"),
            plate_confidence=float(item.get("plate_confidence") or 0.8),
            vehicle_type=item.get("vehicle_type"),
            color=item.get("color"),
            make=item.get("make"),
            model=item.get("model"),
            crop_url=item.get("crop_url"),
            full_frame_url=item.get("full_frame_url"),
            match_score=round(composite, 3),
            match_reasons=match_reasons
        ))

    # Sort descending by composite match_score
    scored_results.sort(key=lambda x: x.match_score, reverse=True)
    return scored_results


def _calc_attribute_score(item: Dict[str, Any], parsed: ParsedQuery) -> float:
    """Calculates attribute similarity score (0.0 to 1.0)."""
    total_checks = 0
    matches = 0

    if parsed.color:
        total_checks += 1
        item_color = str(item.get("color") or "").lower()
        if parsed.color.lower() in item_color or item_color in parsed.color.lower():
            matches += 1

    if parsed.vehicle_type:
        total_checks += 1
        item_type = str(item.get("vehicle_type") or "").lower()
        if parsed.vehicle_type.lower() in item_type or item_type in parsed.vehicle_type.lower():
            matches += 1

    if parsed.make:
        total_checks += 1
        item_make = str(item.get("make") or "").lower()
        if parsed.make.lower() in item_make or item_make in parsed.make.lower():
            matches += 1

    if parsed.model:
        total_checks += 1
        item_model = str(item.get("model") or "").lower()
        if parsed.model.lower() in item_model or item_model in parsed.model.lower():
            matches += 1

    if total_checks == 0:
        return 0.75  # neutral baseline

    return matches / total_checks


def _calc_plate_score(item: Dict[str, Any], parsed: ParsedQuery) -> float:
    """Calculates license plate match score."""
    if not parsed.plate_pattern:
        return 0.5  # neutral if no plate queried

    item_plate = str(item.get("license_plate") or "").upper().replace("-", "").replace(" ", "")
    query_plate = parsed.plate_pattern.upper().replace("-", "").replace(" ", "")

    if query_plate in item_plate or item_plate in query_plate:
        return 1.0
    return 0.1


def _calc_spatial_score(item: Dict[str, Any], target_camera_ids: List[str]) -> float:
    """Calculates spatial proximity score based on target camera list."""
    if not target_camera_ids:
        return 0.5  # neutral if no location specified

    item_cam = str(item.get("camera_id", ""))
    if item_cam in target_camera_ids:
        return 1.0
    return 0.2


def _calc_temporal_score(timestamp: Any, parsed: ParsedQuery) -> float:
    """Calculates temporal score decay."""
    if not parsed.time_range or not timestamp:
        return 0.8  # baseline recency score

    try:
        ts = timestamp if isinstance(timestamp, datetime) else datetime.fromisoformat(str(timestamp))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        if parsed.time_range.start_time <= ts <= parsed.time_range.end_time:
            return 1.0
        return 0.3
    except Exception:
        return 0.5
