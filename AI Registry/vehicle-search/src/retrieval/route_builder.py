"""
Route & Path Generator.

Sequences chronologically matched vehicle sightings into a vehicle trajectory route
for visual mapping on Leaflet / Mapbox UI, using real camera coordinates from PostGIS.
"""

import math
from typing import List, Optional
from datetime import datetime
from ..schemas.search import SightingResult, RouteResponse, RouteWaypoint, RouteSegment


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lng coordinates in km."""
    r_km = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r_km * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def build_vehicle_route(sightings: List[SightingResult], vehicle_id: Optional[str] = None) -> RouteResponse:
    """Builds an ordered route object from a list of vehicle sightings."""
    if not sightings:
        return RouteResponse(
            vehicle_id=vehicle_id or "UNKNOWN",
            total_sightings=0,
            waypoints=[],
            segments=[],
            duration_minutes=0.0
        )

    # Sort chronologically (oldest first)
    chrono_sightings = sorted(sightings, key=lambda s: s.timestamp or datetime.min)

    waypoints: List[RouteWaypoint] = []
    segments: List[RouteSegment] = []

    for idx, s in enumerate(chrono_sightings):
        # Use real coordinates from camera table if present and non-zero
        if s.latitude and s.longitude and (abs(s.latitude) > 0.001 or abs(s.longitude) > 0.001):
            lat, lon = s.latitude, s.longitude
        else:
            # Fallback to Ahmedabad center default
            lat, lon = 23.0225, 72.5714

        wp = RouteWaypoint(
            sighting_id=s.id,
            camera_id=s.camera_id,
            camera_name=s.camera_name,
            timestamp=s.timestamp,
            latitude=lat,
            longitude=lon,
            crop_url=s.crop_url,
            license_plate=s.license_plate
        )
        waypoints.append(wp)

    # Build segments between consecutive waypoints
    for i in range(len(waypoints) - 1):
        w1 = waypoints[i]
        w2 = waypoints[i+1]

        # Calculate time delta in minutes
        t1 = w1.timestamp if isinstance(w1.timestamp, datetime) else datetime.fromisoformat(str(w1.timestamp))
        t2 = w2.timestamp if isinstance(w2.timestamp, datetime) else datetime.fromisoformat(str(w2.timestamp))
        delta_mins = max(0.1, (t2 - t1).total_seconds() / 60.0)

        # Calculate real geographical distance in km
        dist_km = _haversine_km(w1.latitude, w1.longitude, w2.latitude, w2.longitude)
        hours = delta_mins / 60.0
        speed_kmh = round(dist_km / hours, 1) if hours > 0 else 0.0

        segment = RouteSegment(
            from_camera_id=w1.camera_id,
            to_camera_id=w2.camera_id,
            from_timestamp=w1.timestamp,
            to_timestamp=w2.timestamp,
            travel_time_minutes=round(delta_mins, 1),
            estimated_speed_kmh=min(140.0, max(10.0, speed_kmh))
        )
        segments.append(segment)

    # Total duration
    t_start = waypoints[0].timestamp if isinstance(waypoints[0].timestamp, datetime) else datetime.fromisoformat(str(waypoints[0].timestamp))
    t_end = waypoints[-1].timestamp if isinstance(waypoints[-1].timestamp, datetime) else datetime.fromisoformat(str(waypoints[-1].timestamp))
    total_mins = max(0.0, (t_end - t_start).total_seconds() / 60.0)

    target_vehicle_id = vehicle_id or (sightings[0].license_plate if sightings[0].license_plate else f"VEH-{sightings[0].id[:6]}")

    return RouteResponse(
        vehicle_id=target_vehicle_id,
        total_sightings=len(waypoints),
        waypoints=waypoints,
        segments=segments,
        duration_minutes=round(total_mins, 1)
    )
