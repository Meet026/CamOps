# Sentinel --- Natural Language Vehicle Search & Multimodal Retrieval

## Detailed Implementation Plan for Claude

**Project:** Sentinel --- Gujarat Police Innovation Hackathon 2026\
**Purpose:** Extend the existing vehicle re-identification system from
image/crop-based search into a natural-language, multimodal
vehicle-search system.

------------------------------------------------------------------------

# 1. Executive Summary

## 1.1 Current capability

The current vehicle Re-ID system is already capable of:

``` text
Vehicle image
    ↓
Vehicle detection / crop
    ↓
Vehicle Re-ID embedding
    ↓
Similarity search
    ↓
Historical vehicle sightings
    ↓
Camera + timestamp + route/map
```

The current user-facing vehicle-search flow deliberately expects a photo
already focused on a single vehicle.

The system does **not** yet provide a natural-language search such as:

> "I saw a white Wagon R near Vaishnodevi Circle on SG Highway."

The system also does not yet have a complete always-on live RTSP
ingestion pipeline. The existing project documentation explicitly
identifies live video ingestion as a future Model-2 capability.

## 1.2 Target capability

Implement a new **Natural Language Vehicle Search** capability:

``` text
User:
"I saw a white Wagon R near Vaishnodevi Circle on SG Highway."

                    ↓

Natural Language Query Understanding

                    ↓

Structured Search Intent

{
  vehicle:
    color = white
    make = Maruti Suzuki
    model = Wagon R

  location:
    Vaishnodevi Circle / SG Highway

  time:
    unspecified
}

                    ↓

Location filtering + structured filtering
                    ↓
Multimodal semantic retrieval
                    ↓
Existing vehicle Re-ID verification/reranking
                    ↓
Chronological sighting aggregation
                    ↓
Map + timeline + conversational answer
```

The new system must **extend**, not replace, the existing Re-ID
functionality.

------------------------------------------------------------------------

# 2. Source-of-Truth Project Understanding

The implementation must preserve the architecture already established in
the project.

## 2.1 Existing systems

Sentinel currently has three major logical parts:

1.  **Camera Registry / Model 1**
    -   Camera metadata
    -   Geographic location
    -   Department/ownership information
    -   Health/reachability status
    -   GIS/map functionality
    -   Authentication/roles/audit patterns
2.  **Web Application**
    -   Officer-facing UI
    -   Camera management
    -   Maps
    -   Existing vehicle search UI
    -   Existing authentication
3.  **Vehicle Re-Identification System**
    -   Python-based AI service
    -   YOLO vehicle detection
    -   Vehicle crop generation
    -   Vehicle Re-ID embedding
    -   FastAPI service
    -   PostgreSQL + pgvector
    -   Historical vehicle sighting search
    -   Chronological route generation

## 2.2 Important current limitation

The existing Re-ID model operates on a vehicle crop.

The current pipeline is effectively:

``` text
Image
  ↓
Vehicle crop
  ↓
Re-ID embedding
  ↓
Vector similarity search
```

Do not remove this pipeline.

It remains the primary **individual-vehicle identity signal**.

## 2.3 Live video limitation

The existing project documentation states that actual live RTSP
ingestion is not currently implemented.

The hackathon ingest specification provides live RTSP streams and
requires clients to consume them correctly.

Therefore the target implementation has two related but separable
tracks:

### Track A --- Search enhancement

Natural language → search existing vehicle sightings.

### Track B --- Continuous data generation

RTSP → frame sampling → detection → tracking → Re-ID/attributes →
vehicle sightings.

Track A can be implemented and demonstrated before Track B is complete.

------------------------------------------------------------------------

# 3. Goals

## 3.1 Primary goals

Implement:

-   Natural-language vehicle search.
-   Vehicle attribute extraction from stored sightings.
-   Location-aware search.
-   Time-aware search.
-   Semantic image/text retrieval.
-   Hybrid retrieval using structured filters + multimodal similarity +
    existing Re-ID.
-   Search result ranking.
-   Route/track aggregation.
-   Conversational response generation.
-   Evidence/explanation for why a result was returned.
-   Compatibility with the existing image-upload search.
-   Architecture ready for live RTSP ingestion.

## 3.2 Secondary goals

Prepare the system for:

-   Multilingual queries.
-   Query follow-ups.
-   "Show the route."
-   "Show the latest sighting."
-   "Find similar vehicles."
-   Future watchlist/alert functionality.

## 3.3 Explicit non-goals for the first implementation

Do NOT initially build:

-   Facial recognition.
-   Criminal-record integration.
-   Government vehicle-registration integration.
-   Fully autonomous investigative decisions.
-   LLM-generated SQL directly against the database.
-   End-to-end replacement of the existing Re-ID model.
-   A completely new vector database if PostgreSQL + pgvector is
    sufficient.
-   A research-grade end-to-end video-language transformer.
-   Automatic claims that a result is a confirmed identity.

------------------------------------------------------------------------

# 4. Core Architectural Principle

The LLM must **not** be the source of truth for vehicle identity.

Use the LLM for:

-   Natural-language understanding.
-   Intent extraction.
-   Query normalization.
-   Conversational interaction.
-   Result explanation.

Use deterministic/backend systems for:

-   Geographic filtering.
-   Attribute filtering.
-   Database retrieval.
-   Vector similarity.
-   Vehicle identity verification.
-   Ranking.
-   Route construction.

The target pattern is:

``` text
User
 ↓
LLM / Query Parser
 ↓
Structured SearchRequest
 ↓
Search Orchestrator
 ├── SQL / structured filtering
 ├── PostGIS geographic filtering
 ├── vision-language retrieval
 └── existing Re-ID retrieval
 ↓
Candidate fusion
 ↓
Re-ranking
 ↓
Evidence
 ↓
LLM response
```

Never implement:

``` text
User
 ↓
LLM
 ↓
LLM-generated arbitrary SQL
 ↓
Database
```

------------------------------------------------------------------------

# 5. Target Architecture

``` text
                         SENTINEL
                            │
             ┌──────────────┴──────────────┐
             │                             │
       CAMERA / AI SIDE              SEARCH SIDE
             │                             │
             ▼                             ▼
        RTSP Cameras                  User Query
             │                             │
             ▼                             ▼
       Video Ingestion              Query Understanding
             │                             │
             ▼                             ▼
      Frame Sampling              Structured Search Intent
             │                             │
             ▼                             │
      Vehicle Detection                    │
             │                             │
             ▼                             │
         Tracking                          │
             │                             │
       ┌─────┼─────────┐                   │
       ▼     ▼         ▼                   │
     Re-ID  Attributes  VLM                │
       │     │         │                   │
       └─────┼─────────┘                   │
             │                             │
             ▼                             ▼
       PostgreSQL + pgvector + PostGIS
                     │
                     ▼
              Hybrid Retrieval
                     │
                     ▼
                Re-ranking
                     │
                     ▼
               Route Builder
                     │
             ┌───────┴────────┐
             ▼                ▼
           Map             Chatbot
```

------------------------------------------------------------------------

# 6. Component Responsibilities

## 6.1 Query Understanding Service

Input:

``` json
{
  "query": "I saw a white Wagon R near Vaishnodevi Circle on SG Highway"
}
```

Output:

``` json
{
  "intent": "vehicle_search",
  "vehicle": {
    "type": "car",
    "make": "Maruti Suzuki",
    "model": "Wagon R",
    "color": "white"
  },
  "location": {
    "place": "Vaishnodevi Circle",
    "road": "SG Highway",
    "radius_meters": 1500
  },
  "time": {
    "start": null,
    "end": null
  },
  "semantic_description": "white Maruti Suzuki Wagon R"
}
```

The schema must be validated after LLM output.

If the LLM returns invalid fields, reject/repair through deterministic
validation rather than trusting the raw output.

------------------------------------------------------------------------

# 7. SearchRequest Contract

Create a typed internal search contract.

Example:

``` python
class VehicleSearchRequest:
    intent: str

    vehicle_type: str | None
    vehicle_make: str | None
    vehicle_model: str | None
    vehicle_color: str | None

    location_name: str | None
    latitude: float | None
    longitude: float | None
    radius_meters: int | None

    start_time: datetime | None
    end_time: datetime | None

    semantic_description: str | None

    limit: int
```

Add:

``` python
query_id
user_id
created_at
```

for auditability.

------------------------------------------------------------------------

# 8. Intent Types

Initially support:

``` text
vehicle_search
route_search
latest_sighting
similar_vehicle_search
```

Future:

``` text
monitor_vehicle
watchlist_search
alert_status
```

Example:

> "Find a white Wagon R near Vaishnodevi."

→ `vehicle_search`

> "Show me where it went after Vaishnodevi."

→ `route_search`

> "Where was the latest sighting?"

→ `latest_sighting`

> "Find cars that look like this."

→ `similar_vehicle_search`

------------------------------------------------------------------------

# 9. Vehicle Ontology / Normalization

Natural language contains variations.

Examples:

``` text
wagonar
wagon r
wagon-r
wagonr
Maruti Wagon
Maruti Suzuki Wagon R
```

Normalize to:

``` text
make = Maruti Suzuki
model = Wagon R
```

Maintain a canonical vehicle vocabulary/alias table.

Example:

``` text
vehicle_model_alias
-------------------
id
make
canonical_model
alias
```

Example records:

``` text
Maruti Suzuki | Wagon R | wagonar
Maruti Suzuki | Wagon R | wagon-r
Maruti Suzuki | Wagon R | wagonr
```

Do not depend entirely on LLM normalization.

Use:

``` text
LLM normalization
        +
canonical alias table
        +
fuzzy matching
```

------------------------------------------------------------------------

# 10. Vehicle Attribute Extraction

Every vehicle sighting should ideally contain:

``` text
vehicle_type
vehicle_make
vehicle_model
vehicle_color
```

with confidence:

``` text
vehicle_type_confidence
make_confidence
model_confidence
color_confidence
```

Example:

``` json
{
  "vehicle_type": "car",
  "vehicle_make": "Maruti Suzuki",
  "vehicle_model": "Wagon R",
  "vehicle_color": "white",
  "vehicle_type_confidence": 0.99,
  "make_confidence": 0.92,
  "model_confidence": 0.89,
  "color_confidence": 0.96
}
```

## Recommended extraction strategy

Do not run an expensive VLM on every video frame.

Use:

``` text
vehicle crop
    ↓
lightweight attribute classifier
    ↓
high confidence → accept
low confidence → VLM fallback
```

Attribute extraction should run on a representative/best crop from a
tracklet rather than every frame.

------------------------------------------------------------------------

# 11. Vision-Language Retrieval

Evaluate a vision-language model such as **SigLIP 2** for image/text
retrieval.

The goal is:

``` text
Text:
"white Wagon R"

        ↓
Text embedding
```

and:

``` text
Vehicle crop
        ↓
Image embedding
```

in a shared semantic space.

Store the resulting image embedding as:

``` text
vl_embedding
```

This is separate from:

``` text
reid_embedding
```

Do not replace the existing Re-ID embedding.

The vision-language model provides **semantic relevance**.

The Re-ID model provides **individual vehicle similarity**.

------------------------------------------------------------------------

# 12. Database Changes

Extend the existing vehicle-sighting representation.

Recommended conceptual schema:

``` text
vehicle_sighting
------------------------------
id
camera_id
timestamp

track_id
first_seen
last_seen

image_url
crop_url

vehicle_type
vehicle_make
vehicle_model
vehicle_color

vehicle_type_confidence
vehicle_make_confidence
vehicle_model_confidence
vehicle_color_confidence

reid_embedding
vl_embedding

detection_confidence
```

If the existing schema already has equivalent fields, reuse them instead
of duplicating.

Do not create duplicate camera metadata.

The existing camera registry remains the source of truth for camera
identity and location.

------------------------------------------------------------------------

# 13. Tracklet Support

The live pipeline must not store one permanent sighting for every frame.

Bad:

``` text
Car
 ↓
frame 1 → DB
frame 2 → DB
frame 3 → DB
...
frame 100 → DB
```

Better:

``` text
Car enters camera
 ↓
Track ID = 381
 ↓
multiple frames
 ↓
best representative crop
 ↓
one consolidated tracklet
```

Tracklet fields:

``` text
track_id
camera_id
first_seen
last_seen
representative_crop
representative_reid_embedding
representative_vl_embedding
attributes
```

Multiple embeddings may optionally be retained for robustness.

------------------------------------------------------------------------

# 14. Geographic Search

The existing camera registry/GIS data must be reused.

User:

``` text
"near Vaishnodevi Circle"
```

must become:

``` text
place → coordinates → radius
```

Then:

``` text
coordinates
     ↓
PostGIS geographic filter
     ↓
candidate cameras
```

Example conceptual query:

``` sql
SELECT camera_id
FROM camera
WHERE ST_DWithin(
    location,
    query_point,
    radius_meters
);
```

Use the actual existing schema/types rather than assuming this exact
SQL.

------------------------------------------------------------------------

# 15. Location Resolution

Create a location-resolution layer.

Input:

``` text
Vaishnodevi
Vaishnodevi Circle
Vaishnodevi Circle SG Highway
near Vaishnodevi
```

Output:

``` json
{
  "canonical_name": "Vaishnodevi Circle",
  "latitude": "...",
  "longitude": "...",
  "radius_meters": 1500
}
```

Prefer existing camera/location data first.

If a geocoder is introduced, make it replaceable behind an interface.

Do not hard-code one external geocoding provider into business logic.

------------------------------------------------------------------------

# 16. Time Parsing

Support:

``` text
today
yesterday
this morning
around 10 AM
between 10 and 11 AM
last night
on October 5
after 8 PM
before noon
```

Normalize to:

``` text
start_time
end_time
```

If the user provides no time:

``` text
start_time = null
end_time = null
```

Do not invent a time.

If the query is ambiguous, the chatbot may ask a clarification question.

------------------------------------------------------------------------

# 17. Hybrid Retrieval Pipeline

This is the core search implementation.

## Step 1 --- Parse query

``` text
natural language
       ↓
SearchRequest
```

## Step 2 --- Resolve location

``` text
location
 ↓
coordinates/radius
```

## Step 3 --- Apply structured filters

Possible filters:

``` text
vehicle_type
vehicle_make
vehicle_model
vehicle_color
camera_ids
time range
```

## Step 4 --- Semantic retrieval

Generate query text embedding and search against:

``` text
vl_embedding
```

## Step 5 --- Existing Re-ID retrieval

If a visual reference image exists, search:

``` text
reid_embedding
```

If the query is text-only and no vehicle image exists, do not fabricate
a Re-ID embedding.

## Step 6 --- Candidate fusion

Combine:

``` text
structured match
+
geographic relevance
+
time relevance
+
VL similarity
+
Re-ID similarity where available
```

## Step 7 --- Ranking

Return top N candidates.

------------------------------------------------------------------------

# 18. Ranking Strategy

Start with configurable weights rather than hard-coding them
permanently.

Example initial scoring:

``` python
final_score = (
    0.25 * model_score +
    0.15 * color_score +
    0.20 * geo_score +
    0.20 * vl_score +
    0.20 * reid_score
)
```

But:

-   If no image query exists, exclude/renormalize the Re-ID component.
-   If the user provides no location, exclude/renormalize geo scoring.
-   If model is unknown, don't penalize the result.
-   If color is unknown, don't penalize the result.

Implement score normalization first.

Example:

``` python
weighted_average(
    available_signals
)
```

rather than always dividing by 1.0.

All weights must be configuration-driven.

------------------------------------------------------------------------

# 19. Candidate Ranking Example

Query:

> "White Wagon R near Vaishnodevi Circle."

Candidate A:

``` text
model match: 1.00
color match: 0.98
geo score: 0.96
VL score: 0.91
```

Candidate B:

``` text
model match: 0.91
color match: 0.97
geo score: 0.72
VL score: 0.84
```

Candidate A should rank higher.

The exact weights must be validated using real test cases rather than
assumed to be optimal.

------------------------------------------------------------------------

# 20. Re-ID Usage

The existing Re-ID model remains the strongest signal when an image is
available.

Example:

``` text
User:
"Find this white Wagon R near Vaishnodevi."
+
uploaded image
```

Pipeline:

``` text
image
 ↓
existing detector/crop
 ↓
existing Re-ID embedding
 ↓
hybrid search
 ↓
location/model/color filters
 ↓
Re-ID ranking
```

This creates a very strong multimodal query:

``` text
text + image + location + time
```

------------------------------------------------------------------------

# 21. Search API

Add an API such as:

``` http
POST /api/vehicle-search/natural-language
```

Request:

``` json
{
  "query": "I saw a white Wagon R near Vaishnodevi Circle on SG Highway"
}
```

Optional:

``` http
multipart/form-data
```

for an image:

``` text
query
image
```

Response:

``` json
{
  "query_id": "...",
  "interpretation": {
    "vehicle": {
      "color": "white",
      "make": "Maruti Suzuki",
      "model": "Wagon R"
    },
    "location": {
      "name": "Vaishnodevi Circle"
    }
  },
  "results": [
    {
      "sighting_id": "...",
      "camera_id": "...",
      "camera_name": "...",
      "timestamp": "...",
      "latitude": "...",
      "longitude": "...",
      "match_score": 0.91,
      "evidence": {
        "color": 0.98,
        "model": 0.94,
        "geo": 0.96,
        "vl": 0.88,
        "reid": null
      },
      "image_url": "..."
    }
  ]
}
```

The response should clearly distinguish:

``` text
possible match
```

from:

``` text
confirmed identity
```

The system must never claim certainty that the underlying model cannot
support.

------------------------------------------------------------------------

# 22. Conversational API

Add a separate conversational endpoint if appropriate:

``` http
POST /api/vehicle-search/chat
```

Request:

``` json
{
  "conversation_id": "...",
  "message": "Show me the latest one"
}
```

The backend should resolve:

``` text
"the latest one"
```

against the previous search context.

Do not ask the LLM to reconstruct the complete history from raw chat
every time.

Persist structured search context.

Example:

``` text
conversation
    ↓
search_context
    ↓
last SearchRequest
    ↓
follow-up query
```

------------------------------------------------------------------------

# 23. Example Conversation

User:

> I saw a white Wagon R near Vaishnodevi Circle.

System:

> I found 7 possible sightings near Vaishnodevi Circle. The strongest
> match was at 10:42 AM.

User:

> Show me where it went after that.

System:

``` text
10:42 AM — Vaishnodevi Circle
10:49 AM — Sola Bridge
10:56 AM — Thaltej
```

Map:

``` text
Vaishnodevi
     ↓
Sola Bridge
     ↓
Thaltej
```

User:

> Show the latest sighting.

System:

> Latest possible sighting: Thaltej camera at 10:56 AM.

------------------------------------------------------------------------

# 24. Chatbot Response Rules

The LLM response layer must:

1.  Use only returned search evidence.
2.  Never invent cameras.
3.  Never invent timestamps.
4.  Never invent confidence scores.
5.  Never claim a vehicle is confirmed when it is only a possible match.
6.  State when no matching result was found.
7.  State when insufficient information is available.
8.  Ask clarification when the query is too ambiguous.

Example:

Good:

> "I found 4 possible white Wagon R sightings near Vaishnodevi Circle.
> The strongest candidate was detected at 10:42 AM."

Bad:

> "The suspect definitely travelled from Vaishnodevi to Thaltej."

------------------------------------------------------------------------

# 25. Frontend Chat UI

Add a dedicated Sentinel AI Search experience.

Suggested UI:

``` text
┌──────────────────────────────────────────────┐
│ Sentinel AI Search                           │
│                                              │
│ Ask about vehicle sightings...               │
│                                              │
│ "I saw a white Wagon R near Vaishnodevi"     │
│                                              │
│ [ Search ] [ Upload Vehicle Image ]          │
└──────────────────────────────────────────────┘
```

Result area:

``` text
┌──────────────────────────────────────────────┐
│ 5 possible matches                           │
│                                              │
│ 🚗 White Maruti Wagon R                      │
│                                              │
│ 91%   Vaishnodevi Circle   10:42 AM          │
│ 87%   Sola Bridge          10:49 AM          │
│ 82%   Thaltej              10:56 AM          │
│                                              │
│ [View Route] [View Evidence]                 │
└──────────────────────────────────────────────┘
```

Map should reuse the existing Leaflet/GIS infrastructure.

Do not build a second map system.

------------------------------------------------------------------------

# 26. Evidence Panel

Each result should expose:

``` text
Vehicle
Camera
Location
Timestamp
Representative image
Match score
```

And, where available:

``` text
Color match
Model match
Location relevance
Visual-language similarity
Re-ID similarity
```

This is important for transparency and debugging.

------------------------------------------------------------------------

# 27. Existing Image Search Must Continue Working

Regression requirement:

``` text
Existing image upload
        ↓
existing search API
        ↓
existing results
```

must continue to work.

Do not break the current API contract unnecessarily.

Prefer:

``` text
existing image-search endpoint
```

plus:

``` text
new natural-language endpoint
```

Then optionally unify them internally through the same Search
Orchestrator.

------------------------------------------------------------------------

# 28. Live Video Ingestion

This is the second major implementation stream.

The hackathon ingest specification says:

-   Cameras are exposed through RTSP/RTP.
-   RTSP should be consumed over TCP.
-   The camera catalogue should be discovered dynamically.
-   Camera properties can differ.
-   The client must handle reconnects.
-   Timing should use PTS rather than arrival time.
-   H.264/H.265 streams must be supported.
-   Do not process every frame unnecessarily.
-   Do not hard-code the stream list.

Implement a separate Python inference service/worker.

------------------------------------------------------------------------

# 29. Live Pipeline

Target:

``` text
Camera Catalogue
      ↓
Camera Worker Manager
      ↓
RTSP Worker per active camera
      ↓
Frame sampling
      ↓
YOLO detector
      ↓
Multi-object tracker
      ↓
Vehicle crop
      ↓
Representative frame selection
      ↓
Re-ID embedding
      ↓
Attribute extraction
      ↓
VL embedding
      ↓
Tracklet storage
```

------------------------------------------------------------------------

# 30. Frame Sampling

Do not run inference on every frame.

Start with configurable sampling:

``` text
PROCESS_INTERVAL_SECONDS = 1.0–2.0
```

However, do not rely on wall-clock arrival time for event timestamps.

Use stream PTS for temporal information.

The actual interval must be benchmarked based on:

-   camera count
-   GPU capacity
-   vehicle density
-   required recall

------------------------------------------------------------------------

# 31. Tracking

Use a multi-object tracker such as:

``` text
ByteTrack
```

or:

``` text
BoT-SORT
```

Benchmark both if necessary.

The goal is to maintain:

``` text
track_id
```

for a vehicle while it remains visible.

Do not store every frame as an independent sighting.

------------------------------------------------------------------------

# 32. Representative Frame Selection

For each track:

``` text
multiple vehicle crops
       ↓
quality scoring
       ↓
best crop
```

Quality signals can include:

``` text
detector confidence
bounding-box area
blur score
occlusion
brightness
pose/view quality
```

Use the best frame for:

-   Re-ID
-   attributes
-   VL embedding
-   evidence image

Optionally retain a small number of top-quality crops.

------------------------------------------------------------------------

# 33. Re-ID Deduplication

If the same vehicle is detected in consecutive frames:

``` text
Track 381
10:42:01
10:42:02
10:42:03
...
```

do not create dozens of independent sightings.

Store one tracklet:

``` text
first_seen = 10:42:01
last_seen  = 10:42:18
camera_id  = ...
```

When the vehicle disappears and later reappears, create a new tracklet.

------------------------------------------------------------------------

# 34. Live Data Storage Strategy

Recommended:

``` text
vehicle_tracklet
--------------------------
id
camera_id
track_id
first_seen
last_seen

representative_crop_url

vehicle_type
vehicle_make
vehicle_model
vehicle_color

reid_embedding
vl_embedding

confidence
```

If the current `vehicle_sighting` table is already used by the
application, extend it carefully or introduce a tracklet abstraction
without breaking existing consumers.

Do not duplicate camera metadata.

------------------------------------------------------------------------

# 35. Video Worker Architecture

Do not create one uncontrolled Python process per camera.

Use:

``` text
Inference Service
      │
      ├── Camera Worker 1
      ├── Camera Worker 2
      ├── Camera Worker 3
      └── ...
```

The worker manager should:

-   Load camera catalogue.
-   Start active camera workers.
-   Stop disabled cameras.
-   Restart failed streams.
-   Apply exponential backoff.
-   Monitor worker health.
-   Limit concurrency based on GPU capacity.

------------------------------------------------------------------------

# 36. RTSP Failure Handling

Required:

``` text
connect
 ↓
read
 ↓
failure
 ↓
log
 ↓
reconnect with backoff
```

Example:

``` text
2 seconds
4 seconds
8 seconds
16 seconds
30 seconds maximum
```

Do not reconnect in a tight loop.

------------------------------------------------------------------------

# 37. GPU Inference Optimization

Batch inference where practical.

Potential structure:

``` text
Camera workers
     ↓
frame queue
     ↓
batcher
     ↓
GPU inference
     ↓
results routed back to tracks
```

Start with a simpler architecture if camera count is small.

Do not prematurely build distributed infrastructure.

Benchmark before optimizing.

------------------------------------------------------------------------

# 38. Model Loading

Models must be loaded once per worker/service lifecycle.

Do not do:

``` python
for frame:
    model = load_model()
```

Use:

``` text
service startup
 ↓
load YOLO
load Re-ID
load attribute models
load VL model
 ↓
process frames
```

------------------------------------------------------------------------

# 39. Model Runtime

The existing project already uses:

-   PyTorch for training/inference development.
-   ONNX Runtime for lightweight inference.
-   YOLO for vehicle detection.
-   FastAPI.
-   PostgreSQL + pgvector.

Continue to support the existing runtime.

Where performance requires it, benchmark:

``` text
PyTorch
vs
ONNX Runtime
vs
TensorRT
```

Do not rewrite working inference without measured evidence.

------------------------------------------------------------------------

# 40. Vector Indexes

Use PostgreSQL + pgvector initially.

Maintain separate vectors:

``` text
reid_embedding
vl_embedding
```

Create appropriate ANN indexes.

HNSW should be the first candidate to benchmark.

For filtered searches, verify query plans and recall.

Do not introduce another vector database unless benchmarks demonstrate
that PostgreSQL + pgvector is insufficient.

------------------------------------------------------------------------

# 41. Candidate Retrieval Optimization

Use a funnel:

``` text
10M sightings
      ↓
geographic filter
      ↓
attribute filter
      ↓
time filter
      ↓
semantic/vector retrieval
      ↓
top 100
      ↓
Re-ID reranking
      ↓
top 10
```

Never perform expensive VLM/Re-ID processing across the entire
historical database at query time.

Embeddings should already exist.

------------------------------------------------------------------------

# 42. Search Result Deduplication

The same vehicle may appear:

``` text
frame 1
frame 2
frame 3
tracklet 1
```

Search results should be aggregated.

Example:

``` text
Camera A
10:42:01–10:42:18
```

instead of:

``` text
10:42:01
10:42:02
10:42:03
...
```

------------------------------------------------------------------------

# 43. Route Construction

Given matched tracklets:

``` text
[
  {
    camera: Vaishnodevi,
    time: 10:42
  },
  {
    camera: Sola,
    time: 10:49
  },
  {
    camera: Thaltej,
    time: 10:56
  }
]
```

sort chronologically.

Then:

``` text
Vaishnodevi
     ↓
Sola
     ↓
Thaltej
```

Use camera coordinates from the registry.

Do not claim a precise road path unless the data actually supports it.

The map route represents:

> camera-to-camera sightings

not necessarily the exact physical route taken between cameras.

------------------------------------------------------------------------

# 44. Confidence Terminology

Use:

``` text
Possible match
Strong candidate
High-confidence retrieval
```

Avoid:

``` text
Confirmed suspect
Definitely the same vehicle
Certain identity
```

unless an actual validated identity mechanism supports such a statement.

------------------------------------------------------------------------

# 45. Audit Logging

Every natural-language search should be auditable.

Store:

``` text
query_id
user_id
timestamp
original_query
parsed_intent
filters
result_count
```

Do not necessarily store sensitive raw content longer than required.

Reuse the existing audit-log approach.

------------------------------------------------------------------------

# 46. Security

The natural-language endpoint must use the existing authentication and
authorization mechanism.

Do not expose the AI service as an unauthenticated public endpoint.

The current documentation identifies the separate AI service
authentication gap; this implementation should close that gap rather
than expanding it.

Recommended:

``` text
Frontend
 ↓
Existing authenticated backend
 ↓
authorized AI search request
 ↓
AI service
```

If the AI service remains separately reachable internally, secure
service-to-service communication.

------------------------------------------------------------------------

# 47. Authorization

Search results must respect the user's access scope.

Before returning:

``` text
vehicle sightings
camera metadata
images
```

check the user's permissions.

Do not allow the chatbot to bypass existing camera/department
permissions.

------------------------------------------------------------------------

# 48. Prompt Injection Protection

Natural-language queries are untrusted input.

The LLM prompt must clearly separate:

``` text
SYSTEM INSTRUCTIONS
QUERY DATA
```

Never allow user text to redefine:

-   tool permissions
-   database access
-   security policies
-   result formatting requirements
-   system instructions

Use structured output/schema validation.

------------------------------------------------------------------------

# 49. LLM Output Validation

Use strict JSON/schema output.

If invalid:

``` text
LLM
 ↓
schema validator
 ↓
invalid
 ↓
repair/retry
```

Never pass arbitrary LLM JSON directly to database functions.

------------------------------------------------------------------------

# 50. Clarification Logic

If the user says:

> "Find the white car."

The system may ask:

> "Do you remember the location or approximate time?"

If there are multiple interpretations:

> "Do you mean a white Wagon R or any white car?"

Do not invent missing attributes.

------------------------------------------------------------------------

# 51. No-result Handling

Example:

> "I couldn't find a matching white Wagon R near Vaishnodevi Circle in
> the available sightings."

Then provide useful next actions:

``` text
Try:
- a larger search radius
- a wider time range
- another vehicle attribute
- uploading a reference image
```

Do not fabricate a result.

------------------------------------------------------------------------

# 52. Query Explanation

For debugging and officer trust, optionally expose:

``` text
Interpreted as:
White
Maruti Suzuki
Wagon R
Near Vaishnodevi Circle
```

This lets the officer correct misunderstandings.

Example:

``` text
You searched for:

Vehicle: White Maruti Suzuki Wagon R
Location: Vaishnodevi Circle
Time: Any available time

[Edit Search]
```

------------------------------------------------------------------------

# 53. Multilingual Support

Design the parser so that multilingual queries can be added later.

Examples:

``` text
"Ek white Wagon R Vaishnodevi ke paas dekhi thi."

"Vaishnodevi Circle ke paas white Wagon R dhoondo."

"મને વૈષ્ણોદેવી પાસે સફેદ Wagon R દેખાઈ હતી."
```

Normalize all into the same `SearchRequest`.

Do not create separate search implementations for every language.

------------------------------------------------------------------------

# 54. Model Selection

## Query LLM

Use whichever LLM is already approved/available in the project
environment.

Requirements:

-   Structured JSON output.
-   Good entity extraction.
-   Good multilingual support if required.
-   Low latency.
-   Configurable provider/model.

Do not hard-code the provider into the search engine.

## Vision-language model

Benchmark SigLIP 2 or an equivalent image-text retrieval model.

Requirements:

-   Image-text shared embedding space.
-   Local inference preferred where feasible.
-   GPU acceleration.
-   Configurable model path.

## Re-ID

Keep the existing Re-ID model.

Make the model path configurable.

------------------------------------------------------------------------

# 55. Configuration

Add configuration for:

``` text
LLM_PROVIDER
LLM_MODEL

VL_MODEL_PATH
VL_EMBEDDING_DIM

REID_MODEL_PATH
REID_EMBEDDING_DIM

VECTOR_INDEX_TYPE

SEARCH_TOP_K
RERANK_TOP_K

DEFAULT_LOCATION_RADIUS_METERS

FRAME_PROCESS_INTERVAL_SECONDS

TRACK_TIMEOUT_SECONDS

MAX_CAMERA_WORKERS

REID_WEIGHT
VL_WEIGHT
GEO_WEIGHT
COLOR_WEIGHT
MODEL_WEIGHT
```

Never hard-code model paths, thresholds, or scoring weights.

------------------------------------------------------------------------

# 56. API Separation

Recommended API grouping:

``` text
/api/vehicle-search/image
/api/vehicle-search/natural-language
/api/vehicle-search/chat
/api/vehicle-search/route
```

Internally:

``` text
VehicleSearchOrchestrator
```

should provide common search functionality.

Example:

``` text
Image Search
      ↓
SearchOrchestrator

Natural Language Search
      ↓
QueryParser
      ↓
SearchOrchestrator

Chat Search
      ↓
ConversationResolver
      ↓
SearchOrchestrator
```

------------------------------------------------------------------------

# 57. Suggested Internal Modules

Python AI service:

``` text
app/
├── api/
│   ├── vehicle_search.py
│   ├── chat_search.py
│   └── route.py
│
├── search/
│   ├── orchestrator.py
│   ├── query_parser.py
│   ├── location_resolver.py
│   ├── filters.py
│   ├── candidate_retrieval.py
│   ├── ranking.py
│   ├── deduplication.py
│   └── route_builder.py
│
├── models/
│   ├── reid.py
│   ├── vision_language.py
│   ├── detector.py
│   ├── attributes.py
│   └── tracker.py
│
├── ingestion/
│   ├── camera_catalog.py
│   ├── rtsp_worker.py
│   ├── worker_manager.py
│   ├── frame_sampler.py
│   └── tracklet_manager.py
│
├── database/
│   ├── models.py
│   ├── repositories.py
│   └── vector_search.py
│
├── schemas/
│   ├── search.py
│   ├── chat.py
│   └── results.py
│
└── config.py
```

Adapt to the existing repository structure rather than blindly creating
this exact layout.

------------------------------------------------------------------------

# 58. Phase-by-Phase Implementation

## Phase 0 --- Repository inspection

Before modifying anything:

1.  Inspect the existing repository.
2.  Identify:
    -   current FastAPI endpoints
    -   current detector implementation
    -   current Re-ID implementation
    -   embedding generation
    -   pgvector schema
    -   camera schema
    -   image-search flow
    -   frontend vehicle-search flow
    -   authentication
    -   audit logging
3.  Do not duplicate existing functionality.
4.  Produce a short implementation mapping before editing.

Deliverable:

``` text
CURRENT_IMPLEMENTATION_MAP.md
```

or an equivalent internal implementation note.

------------------------------------------------------------------------

# 59. Phase 1 --- Data/schema foundation

Implement:

-   vehicle attributes
-   confidence fields
-   VL embedding
-   tracklet support where compatible
-   vector indexes
-   model/version metadata

Migration requirements:

-   Existing rows must remain valid.
-   Existing image-search must continue working.
-   New fields may initially be nullable.
-   Backfill can happen separately.

Add:

``` text
embedding_model
embedding_version
```

so future model upgrades can coexist safely.

------------------------------------------------------------------------

# 60. Phase 2 --- Attribute extraction

Implement:

``` text
crop
 ↓
attribute extraction
 ↓
structured fields
```

Run against a controlled sample first.

Measure:

-   color accuracy
-   make accuracy
-   model accuracy
-   confidence calibration

Do not assume VLM output is ground truth.

------------------------------------------------------------------------

# 61. Phase 3 --- Natural-language query parser

Implement:

``` text
POST /vehicle-search/natural-language
```

Test:

``` text
white Wagon R near Vaishnodevi
white Maruti near SG Highway
black SUV near Sola
car near Vaishnodevi yesterday
white wagonar around 10 AM
```

Test malformed queries too.

------------------------------------------------------------------------

# 62. Phase 4 --- Geographic search

Implement:

``` text
query location
 ↓
canonical location
 ↓
coordinates
 ↓
camera filtering
```

Reuse existing camera registry.

Test:

-   exact camera area
-   radius
-   no matching cameras
-   unknown location
-   ambiguous location
-   highway-only queries

------------------------------------------------------------------------

# 63. Phase 5 --- Vision-language retrieval

Implement:

``` text
stored crop
 ↓
VL embedding
 ↓
pgvector
```

and:

``` text
query description
 ↓
text embedding
 ↓
pgvector
```

Benchmark retrieval quality.

Do not make the VL model the final identity decision.

------------------------------------------------------------------------

# 64. Phase 6 --- Hybrid search

Combine:

``` text
structured filtering
+
geo filtering
+
VL similarity
+
Re-ID similarity
```

Implement configurable scoring.

Add candidate evidence.

------------------------------------------------------------------------

# 65. Phase 7 --- Route builder

Aggregate matching tracklets/sightings.

Sort by time.

Resolve camera metadata.

Return:

``` text
timeline
+
coordinates
+
evidence images
```

Reuse the existing map component.

------------------------------------------------------------------------

# 66. Phase 8 --- Chatbot

Implement:

``` text
conversation_id
message
context
structured search
result
```

Support follow-ups.

Example:

``` text
User:
Find white Wagon R near Vaishnodevi.

User:
Show the latest one.

User:
Where was it before that?
```

The conversation state must retain structured search context.

------------------------------------------------------------------------

# 67. Phase 9 --- Live RTSP ingestion

Implement only after the stored-search path works.

Order:

1.  Discover camera catalogue.
2.  Connect one RTSP stream.
3.  Read frames.
4.  Use PTS.
5.  Add reconnect.
6.  Add sampling.
7.  Run YOLO.
8.  Add tracker.
9.  Create tracklets.
10. Generate Re-ID embedding.
11. Generate attributes.
12. Generate VL embedding.
13. Store tracklet.
14. Expand to multiple cameras.
15. Add worker management.

------------------------------------------------------------------------

# 68. Phase 10 --- Frontend

Build the chat/search experience after the backend contract is stable.

Frontend requirements:

-   chat input
-   optional image upload
-   parsed search interpretation
-   result cards
-   evidence image
-   confidence
-   timeline
-   map
-   route
-   loading state
-   no-result state
-   clarification state
-   error state

Reuse existing UI conventions.

------------------------------------------------------------------------

# 69. Phase 11 --- Monitoring and Observability

Track:

``` text
query latency
LLM latency
location-resolution latency
vector-search latency
Re-ID latency
result count
no-result rate
model inference latency
GPU utilization
camera worker health
RTSP reconnect count
```

For live ingestion:

``` text
camera_id
frames_received
frames_processed
vehicles_detected
tracklets_created
processing_fps
dropped_frames
last_successful_timestamp
```

------------------------------------------------------------------------

# 70. Testing Strategy

## Unit tests

Test:

-   query parsing
-   normalization
-   location resolution
-   time parsing
-   schema validation
-   ranking
-   score normalization
-   result deduplication
-   route ordering

## Integration tests

Test:

``` text
query
 ↓
database
 ↓
vector search
 ↓
ranking
 ↓
response
```

## Existing regression tests

Verify:

``` text
image upload
 ↓
crop
 ↓
Re-ID
 ↓
historical search
```

still works.

## Live pipeline tests

Test:

-   RTSP connect
-   disconnect
-   reconnect
-   mixed codecs
-   timestamp correctness
-   duplicate track handling
-   worker shutdown
-   worker restart

------------------------------------------------------------------------

# 71. Evaluation Dataset

Create a small ground-truth dataset.

Example:

``` text
Query:
"white Wagon R near Vaishnodevi"

Expected:
vehicle model = Wagon R
color = white
location = Vaishnodevi
expected candidate IDs = [...]
```

Build at least:

-   20--50 natural-language queries initially.
-   Multiple phrasings per vehicle.
-   Different locations.
-   Different times.
-   Queries without one attribute.
-   Ambiguous queries.
-   Multilingual examples if multilingual support is enabled.

------------------------------------------------------------------------

# 72. Retrieval Metrics

Measure:

``` text
Recall@1
Recall@5
Recall@10
MRR
```

For route retrieval:

``` text
correct vehicle route retrieval
correct temporal ordering
camera hit recall
```

For structured attributes:

``` text
color accuracy
make accuracy
model accuracy
```

For chatbot:

``` text
intent accuracy
slot/entity extraction accuracy
```

Do not report an impressive metric without a held-out test set.

------------------------------------------------------------------------

# 73. Performance Targets

Initial engineering targets should be measured, not assumed.

Suggested goals:

``` text
Query parsing: < 1–2 sec
Structured filtering: < 200 ms
Vector candidate search: < 500 ms
Reranking: < 500 ms
Total search: ideally < 3 sec
```

For live processing:

-   Avoid unbounded queues.
-   Maintain bounded latency.
-   Drop stale frames rather than allowing infinite backlog.
-   Process only required cameras.
-   Scale inference workers according to GPU capacity.

These are target goals, not guaranteed numbers.

------------------------------------------------------------------------

# 74. Data Retention

Design retention explicitly.

Potential layers:

``` text
Raw frame/video
    ↓
short retention

Representative crop
    ↓
longer retention

Embedding + metadata
    ↓
configured retention

Audit/search logs
    ↓
policy-defined retention
```

Do not assume unlimited historical storage.

------------------------------------------------------------------------

# 75. Model Versioning

Every generated embedding should record:

``` text
model_name
model_version
embedding_version
```

Example:

``` text
reid_model = vehicle_reid_v2
vl_model = siglip2_base
attribute_model = vehicle_attr_v1
```

When upgrading a model:

``` text
old embedding
new embedding
```

must be distinguishable.

Do not silently mix incompatible embeddings in one index.

------------------------------------------------------------------------

# 76. Migration Strategy

Do not require all historical data to be reprocessed before the feature
works.

Recommended:

``` text
Existing sightings
       ↓
new fields nullable

New sightings
       ↓
generate all new metadata

Backfill
       ↓
progressively populate old data
```

Search should gracefully handle records missing VL embeddings.

------------------------------------------------------------------------

# 77. Failure Handling

If the VL model is unavailable:

``` text
fallback:
structured filtering + existing Re-ID/image search
```

If LLM is unavailable:

``` text
existing image search remains available
```

If location resolver fails:

``` text
ask user for clarification
```

If vector search fails:

``` text
return controlled error
```

Do not crash the entire application.

------------------------------------------------------------------------

# 78. Backward Compatibility

Existing endpoints and UI must continue working.

Existing:

``` text
image → vehicle search
```

must remain supported.

The new natural-language search is additive.

------------------------------------------------------------------------

# 79. Recommended Implementation Order for Claude

Claude should implement in this exact order:

``` text
1. Inspect repository
2. Map existing architecture
3. Identify reusable modules
4. Add database migration
5. Add attribute extraction
6. Add query schemas
7. Add query parser
8. Add location resolver
9. Add structured candidate filtering
10. Add VL embedding support
11. Add hybrid retrieval
12. Add ranking
13. Add evidence
14. Add route aggregation
15. Add natural-language API
16. Add chatbot API
17. Add frontend
18. Add live RTSP ingestion
19. Add tracker/tracklets
20. Connect live ingestion to search database
21. Add observability
22. Run regression/evaluation suite
23. Optimize only after measurements
```

------------------------------------------------------------------------

# 80. Claude Implementation Rules

Claude must follow these rules:

### Rule 1

Do not rewrite working modules without a reason.

### Rule 2

Reuse the existing Re-ID model.

### Rule 3

Reuse PostgreSQL + pgvector unless a benchmark proves otherwise.

### Rule 4

Reuse the existing camera registry.

### Rule 5

Reuse existing map/GIS functionality.

### Rule 6

Do not duplicate camera metadata.

### Rule 7

Do not let the LLM directly execute arbitrary SQL.

### Rule 8

Do not claim model results are certain.

### Rule 9

Do not break the existing image-search feature.

### Rule 10

Make model paths, thresholds, weights, and provider configuration
environment-driven.

### Rule 11

Do not hard-code camera stream URLs.

### Rule 12

Use the hackathon camera catalogue as the source for live stream
endpoints.

### Rule 13

Use PTS for video timing.

### Rule 14

Implement reconnect with backoff.

### Rule 15

Do not process every video frame unnecessarily.

### Rule 16

Do not create one DB record per video frame.

### Rule 17

Add tests before declaring a phase complete.

### Rule 18

Measure performance before optimization.

### Rule 19

Do not introduce unnecessary microservices.

### Rule 20

Document all new configuration and deployment requirements.

------------------------------------------------------------------------

# 81. Definition of Done

The feature is considered successfully implemented when all of the
following work:

## Natural-language search

User enters:

> "I saw a white Wagon R near Vaishnodevi Circle on SG Highway."

System:

1.  Understands the query.
2.  Extracts vehicle attributes.
3.  Resolves location.
4.  Finds candidate cameras.
5.  Searches matching sightings.
6.  Ranks candidates.
7.  Returns evidence.
8.  Shows timeline/map.
9.  Provides a conversational response.

## Image + natural language

User provides:

``` text
photo
+
"I saw this near Vaishnodevi."
```

System combines:

``` text
image Re-ID
+
text attributes
+
location
```

and returns ranked results.

## Existing functionality

The old image-upload search continues to work.

## Live ingestion

At least one real RTSP camera can:

``` text
RTSP
 ↓
frame
 ↓
YOLO
 ↓
tracker
 ↓
crop
 ↓
Re-ID
 ↓
attributes
 ↓
VL embedding
 ↓
tracklet DB
```

Then expand to multiple cameras.

------------------------------------------------------------------------

# 82. Example End-to-End Scenario

## Input

``` text
"I saw a white Wagon R near Vaishnodevi Circle around 10 AM."
```

## Query parser

``` json
{
  "vehicle_make": "Maruti Suzuki",
  "vehicle_model": "Wagon R",
  "vehicle_color": "white",
  "location_name": "Vaishnodevi Circle",
  "start_time": "10:00",
  "end_time": "11:00"
}
```

## Geographic filter

``` text
Vaishnodevi Circle
 ↓
candidate cameras
```

## Database filter

``` text
white
+
Wagon R
+
10:00–11:00
+
candidate cameras
```

## VL retrieval

``` text
"white Wagon R"
       ↓
text embedding
       ↓
candidate VL embeddings
```

## Re-ID

Only if an image is supplied:

``` text
reference image
       ↓
Re-ID embedding
       ↓
candidate Re-ID embeddings
```

## Ranking

``` text
candidate 1 = 0.93
candidate 2 = 0.88
candidate 3 = 0.81
```

## Response

``` text
I found 3 possible matches.

Strongest match:
Vaishnodevi Circle Camera 04
10:42 AM
Composite retrieval score: 93%

The vehicle was subsequently observed at:
10:49 AM — Sola Bridge
10:56 AM — Thaltej

[View Route]
[View Evidence]
```

------------------------------------------------------------------------

# 83. Future Extension: Vehicle Watchlist

Do not implement this in the first phase unless required, but keep the
architecture ready.

Future:

``` text
User:
"Monitor this white Wagon R."

       ↓

Watchlist
       ↓
Live detections
       ↓
Re-ID / VL matching
       ↓
Match
       ↓
Alert
```

The same embedding already generated for each live detection can be
compared against a small watchlist.

------------------------------------------------------------------------

# 84. Future Extension: Investigation Assistant

Eventually the chatbot can support:

``` text
"Find the white Wagon R."

"Show me its route."

"What cameras saw it?"

"Show the first sighting."

"Was it seen after 11 PM?"

"Show similar vehicles."

"Monitor it from now on."
```

The same Search Orchestrator should support these operations rather than
implementing separate AI logic for each phrase.

------------------------------------------------------------------------

# 85. Final Target Product

The final Sentinel experience should evolve from:

> **Vehicle image search**

to:

> **Natural-language vehicle intelligence**

The user should be able to provide:

``` text
Text
+
Image
+
Location
+
Time
```

and Sentinel should search:

``` text
Camera network
+
Vehicle attributes
+
Vision-language embeddings
+
Vehicle Re-ID embeddings
+
Temporal information
+
Geographic information
```

and return:

``` text
Relevant vehicles
+
Evidence
+
Timeline
+
Route
+
Map
+
Confidence
```

while preserving the existing Re-ID system as the core
individual-vehicle identity signal.

------------------------------------------------------------------------

# 86. Research / Technical References

Use these references when evaluating model/library choices:

1.  OpenAI CLIP --- image/text representation concept:
    https://openai.com/index/clip/

2.  SigLIP 2 --- vision-language representation and retrieval:
    https://huggingface.co/papers/2502.14786

3.  SigLIP 2 implementation/model documentation:
    https://huggingface.co/blog/siglip2

4.  BGE-M3 --- multilingual text retrieval/embedding:
    https://huggingface.co/BAAI/bge-m3

5.  pgvector --- PostgreSQL vector similarity search, HNSW, IVFFlat and
    filtering: https://github.com/pgvector/pgvector

6.  Multimodal vehicle trajectory retrieval research:
    https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0327468

7.  Natural-language surveillance video retrieval research:
    https://www.sciencedirect.com/science/article/pii/S0957417425042708

These references are for technical evaluation. The existing project
architecture and repository implementation remain the primary source of
truth for integration decisions.

------------------------------------------------------------------------

# 87. Final Instruction to Claude

Before writing code:

1.  Inspect the complete existing repository.
2.  Identify exactly which components already implement:
    -   detector
    -   crop
    -   Re-ID
    -   embeddings
    -   pgvector
    -   camera lookup
    -   route generation
    -   image-search API
    -   frontend vehicle search
3.  Produce an implementation mapping.
4.  Identify conflicts between this plan and the actual repository.
5.  Prefer existing project conventions.
6.  Do not blindly recreate components described in this document if
    equivalent functionality already exists.

Then implement incrementally.

After every major phase:

``` text
run tests
 ↓
verify existing functionality
 ↓
document changes
 ↓
continue
```

Do not implement the entire feature as one untested change.

The primary success criterion is:

> A user can type a natural-language vehicle description such as "I saw
> a white Wagon R near Vaishnodevi Circle on SG Highway" and Sentinel
> can translate that request into a structured, geographically and
> temporally constrained hybrid search over vehicle sightings, rank the
> best candidates using semantic/attribute signals and the existing
> Re-ID system where applicable, and present evidence and a
> chronological route without inventing facts.
