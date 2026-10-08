"""
Sentinel — Natural Language Vehicle Search Microservice.

FastAPI service handling natural-language vehicle search queries, attribute filters,
camera resolution, candidate ranking, multi-turn chat, and route visualization.
"""

import time
import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .config import settings
from .schemas.search import (
    SearchRequest, SearchResponse, SightingResult, ParsedQuery
)
from .schemas.chat import ChatRequest, ChatResponse
from .parser.resolver import parse_query
from .location.camera_resolver import resolve_location_to_cameras
from .retrieval.db_retriever import retrieve_candidate_sightings
from .retrieval.ranker import score_and_rank_sightings
from .retrieval.route_builder import build_vehicle_route

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("vehicle-search")

app = FastAPI(
    title="Sentinel — Vehicle Search Service",
    version="1.0.0",
    description="Natural-language vehicle search and path tracking microservice."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/v1/health")
def health_check():
    """Health check endpoint for Docker / Kubernetes probes."""
    return {
        "status": "healthy",
        "service": "vehicle-search",
        "llm_provider": settings.LLM_PROVIDER,
        "siglip_enabled": settings.SIGLIP_ENABLED
    }


@app.post("/api/v1/search", response_model=SearchResponse)
def search_vehicles(req: SearchRequest):
    """
    Main Natural-Language Vehicle Search API endpoint.
    
    Workflow:
    1. Parse natural language prompt into structured criteria (Color, Type, Make, Model, Plate, Location, Time).
    2. Resolve location text to target camera IDs.
    3. Execute SQL query on vehicle_sighting store.
    4. Score and rank candidates.
    5. Optionally build vehicle route track.
    """
    start_time = time.time()
    
    # 1. Parse natural language prompt
    if req.query and req.query.strip():
        parsed = parse_query(req.query)
    else:
        # Structured-only query
        parsed = ParsedQuery(
            raw_query="",
            color=req.color,
            vehicle_type=req.vehicle_type,
            make=req.make,
            model=req.model,
            plate_pattern=req.license_plate,
            time_range=req.time_range
        )

    # Merge explicit overrides from request if provided
    if req.color: parsed.color = req.color
    if req.vehicle_type: parsed.vehicle_type = req.vehicle_type
    if req.make: parsed.make = req.make
    if req.model: parsed.model = req.model
    if req.license_plate: parsed.plate_pattern = req.license_plate
    if req.time_range: parsed.time_range = req.time_range

    # 2. Resolve location to camera IDs
    target_camera_ids = list(req.camera_ids) if req.camera_ids else []
    if parsed.location_text:
        resolved_cams = resolve_location_to_cameras(parsed.location_text)
        target_camera_ids.extend(resolved_cams)
    target_camera_ids = list(set(target_camera_ids))

    # 3. Retrieve candidates
    candidates = retrieve_candidate_sightings(parsed, target_camera_ids, limit=req.limit * 2)

    # 4. Score & Rank
    ranked_results = score_and_rank_sightings(candidates, parsed, target_camera_ids)

    # 5. Build route for the top-matched target vehicle
    route = None
    display_results = ranked_results[:req.limit]

    if req.include_route and ranked_results:
        top_vehicle = ranked_results[0]
        vehicle_plate = top_vehicle.license_plate

        if vehicle_plate:
            # Collect all sightings for this specific target vehicle
            target_sightings = [s for s in ranked_results if s.license_plate == vehicle_plate]
            if len(target_sightings) < 5:
                extra_candidates = retrieve_candidate_sightings(
                    ParsedQuery(plate_pattern=vehicle_plate), limit=30
                )
                if extra_candidates:
                    extra_scored = score_and_rank_sightings(extra_candidates, parsed, target_camera_ids)
                    seen_ids = {s.id for s in target_sightings}
                    for s in extra_scored:
                        if s.id not in seen_ids and s.license_plate == vehicle_plate:
                            target_sightings.append(s)
            
            # Sort chronologically for path visualization
            target_sightings.sort(key=lambda s: s.timestamp or datetime.min)
            route = build_vehicle_route(target_sightings, vehicle_id=vehicle_plate)
            display_results = target_sightings
        else:
            route = build_vehicle_route(ranked_results[:10])
            display_results = ranked_results[:10]

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    return SearchResponse(
        total=len(display_results),
        results=display_results,
        parsed_query=parsed,
        route=route,
        execution_time_ms=elapsed_ms
    )


@app.post("/api/v1/chat", response_model=ChatResponse)
def chat_search(req: ChatRequest):
    """
    Conversational search endpoint supporting multi-turn search state.
    """
    # Build combined query context from last turn if present
    full_prompt = req.message
    if req.last_query and any(kw in req.message.lower() for kw in ["latest", "where", "after", "before", "next", "that"]):
        if req.last_query.color:
            full_prompt = f"{req.last_query.color} {full_prompt}"
        if req.last_query.model:
            full_prompt = f"{req.last_query.model} {full_prompt}"

    search_req = SearchRequest(query=full_prompt, include_route=True, limit=10)
    search_res = search_vehicles(search_req)

    reply_text = f"Found {search_res.total} matching vehicle sighting(s)."
    if search_res.parsed_query.model or search_res.parsed_query.color:
        desc = f"{search_res.parsed_query.color or ''} {search_res.parsed_query.model or search_res.parsed_query.vehicle_type or 'vehicle'}".strip()
        reply_text = f"Located {search_res.total} sighting(s) for {desc}."
        if search_res.parsed_query.location_text:
            reply_text += f" near {search_res.parsed_query.location_text}."

    return ChatResponse(
        reply=reply_text,
        search_response=search_res,
        conversation_id=req.conversation_id or "conv_default"
    )


if __name__ == "__main__":
    uvicorn.run(
        "src.main:app",
        host=settings.SERVICE_HOST,
        port=settings.SERVICE_PORT,
        reload=settings.DEBUG
    )
