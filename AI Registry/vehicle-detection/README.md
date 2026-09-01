# Vehicle Detection — Phase 2

Detects vehicles in a frame (YOLO11n), crops each one, embeds it using
Phase 0/1's fine-tuned Re-ID model, and stores the result in a
`vehicle_sighting` table (pgvector, on the same Neon database
`model1-service` already uses).

See `../Ai Idea Research.md` (Part 3, Phase 2) for the original design
intent, and `../docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md` for the
Re-ID model this reuses.

## Model choice — verified, not assumed

YOLO11n (Ultralytics official pretrained checkpoint), filtered to COCO's
native vehicle classes (car, truck, bus, motorcycle) — no fine-tuning
needed, since COCO pretraining already covers these classes. Chosen
after real research (not because the original doc just said "e.g.
YOLO") — see the brainstorming session that produced this component for
the comparison against YOLO26/RT-DETR/etc.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

The YOLO11n checkpoint auto-downloads on first use (no separate fetch
script needed, unlike Phase 0's Re-ID model — Ultralytics handles this
directly).

## Database setup (one-time)

Enables `pgvector` on the existing Neon database and creates the
`vehicle_sighting` table:

```bash
python3 scripts/setup_database.py
```

This reuses `model1-service/.env`'s `DATABASE_URL` — no separate
credentials are configured in this project.

## Running

```bash
python3 scripts/run_batch.py --data data/test_images --camera-id <a real camera UUID>
```

Query a single photo against everything stored so far:

```bash
python3 scripts/query_similar.py --photo path/to/query.jpg --limit 5
```

## HTTP API — route formation

Serves `POST /vehicles/route`: upload a photo, get back, per detected
vehicle, a chronologically ordered "route" of past sightings of the same
vehicle across registered cameras (each entry enriched with the real
camera name and lat/long, ready to draw on a map). Frontend integration
is intentionally out of scope here — this is the API only.

```bash
uvicorn src.api:app --reload --port 8000
```

Interactive docs at `http://localhost:8000/docs`. Example:

```bash
curl -X POST http://localhost:8000/vehicles/route \
  -F "photo=@path/to/query.jpg;type=image/jpeg"
```

Response shape:

```json
{
  "detections": [
    {
      "vehicle_class": "car",
      "detection_confidence": 0.63,
      "route": [
        {
          "sighting_id": "...", "camera_id": "...",
          "camera_name": "Chiman bhai Bridge CSITMS-32_PTZ2",
          "latitude": 23.0708, "longitude": 72.5869,
          "detected_at": "2026-09-01T12:41:56.907121+00:00",
          "vehicle_class": "car", "similarity": 1.0
        }
      ],
      "route_threshold_used": 0.8
    }
  ]
}
```

Config (env vars, all optional):

- `ROUTE_SIMILARITY_THRESHOLD` (default `0.80`) — the minimum cosine
  similarity for a stored sighting to count as "the same vehicle" and
  appear in a route. **Not a validated cutoff** — a provisional value,
  deliberately kept configurable so it can be retuned without a code
  change once a better Re-ID model (the full 10,000-vehicle fine-tune)
  is ready.
- `VEHICLE_REID_MODEL_PATH` — override which `.onnx` embedder model to
  load. Defaults to `vehicle-reid/models/vehicle_vit_clip_reid_finetuned.onnx`
  — the Phase 1 fine-tuned model, not the untrained base model (a real
  bug: this used to default to the base model, and this env var was
  never actually set anywhere, so every deployment silently ran the
  weaker model — fixed). Swapping in a better model later (e.g. the full
  10,000-vehicle fine-tune) means changing this one value, not the
  API's code or response shape. Both models are fetched by
  `vehicle-reid/scripts/fetch_model.py`.
- `VEHICLE_DETECTION_YOLO_MODEL` (default `yolo11n.pt`)
- `VEHICLE_DETECTION_CONFIDENCE` (default `0.4`)

## Testing

```bash
pytest tests/ -v
```

Tests needing the real YOLO model or a real database connection are
automatically skipped if those aren't available — set
`VEHICLE_DETECTION_TEST_DATABASE_URL` to opt into the real-database
tests (points at a database with the `vehicle_sighting` table and at
least one real `camera` row already present).
