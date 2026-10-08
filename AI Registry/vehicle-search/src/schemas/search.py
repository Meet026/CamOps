"""
Typed contracts for the vehicle search pipeline.

Every stage of the pipeline (parse → filter → retrieve → rank → respond)
uses these schemas. They are Pydantic v2 models validated at every boundary.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional
from enum import Enum

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Intent types
# ---------------------------------------------------------------------------
class SearchIntent(str, Enum):
    VEHICLE_SEARCH = "vehicle_search"
    ROUTE_SEARCH = "route_search"
    LATEST_SIGHTING = "latest_sighting"
    SIMILAR_VEHICLE = "similar_vehicle_search"


# ---------------------------------------------------------------------------
# Time Range Filter
# ---------------------------------------------------------------------------
class DateRangeFilter(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Parsed Query Output
# ---------------------------------------------------------------------------
class ParsedQuery(BaseModel):
    raw_query: str = ""
    color: Optional[str] = None
    vehicle_type: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    plate_pattern: Optional[str] = None
    location_text: Optional[str] = None
    time_range: Optional[DateRangeFilter] = None
    confidence: float = 1.0


# ---------------------------------------------------------------------------
# Input API Request
# ---------------------------------------------------------------------------
class SearchRequest(BaseModel):
    query: Optional[str] = Field(None, description="Natural language search prompt, e.g., 'white Wagon R near Vaishnodevi circle'")
    color: Optional[str] = None
    vehicle_type: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    license_plate: Optional[str] = None
    camera_ids: List[str] = Field(default_factory=list)
    time_range: Optional[DateRangeFilter] = None
    limit: int = 20
    include_route: bool = True

# Alias for backward compatibility
VehicleSearchRequest = SearchRequest


# ---------------------------------------------------------------------------
# Sighting Result
# ---------------------------------------------------------------------------
class SightingResult(BaseModel):
    id: str
    camera_id: str
    camera_name: str = "Unknown Camera"
    camera_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timestamp: Optional[datetime] = None
    license_plate: Optional[str] = None
    plate_confidence: float = 0.0
    vehicle_type: Optional[str] = None
    color: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    crop_url: Optional[str] = None
    full_frame_url: Optional[str] = None
    match_score: float = 0.0
    match_reasons: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Route Waypoints & Segments
# ---------------------------------------------------------------------------
class RouteWaypoint(BaseModel):
    sighting_id: str
    camera_id: str
    camera_name: str
    timestamp: Optional[datetime] = None
    latitude: float
    longitude: float
    crop_url: Optional[str] = None
    license_plate: Optional[str] = None


class RouteSegment(BaseModel):
    from_camera_id: str
    to_camera_id: str
    from_timestamp: Optional[datetime] = None
    to_timestamp: Optional[datetime] = None
    travel_time_minutes: float
    estimated_speed_kmh: float


class RouteResponse(BaseModel):
    vehicle_id: str
    total_sightings: int
    waypoints: List[RouteWaypoint] = Field(default_factory=list)
    segments: List[RouteSegment] = Field(default_factory=list)
    duration_minutes: float = 0.0


# ---------------------------------------------------------------------------
# Search Response
# ---------------------------------------------------------------------------
class SearchResponse(BaseModel):
    query_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    total: int = 0
    results: List[SightingResult] = Field(default_factory=list)
    parsed_query: ParsedQuery
    route: Optional[RouteResponse] = None
    execution_time_ms: float = 0.0

# Alias for backward compatibility
VehicleSearchResponse = SearchResponse
