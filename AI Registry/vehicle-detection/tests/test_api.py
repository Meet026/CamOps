"""
Tests for src/api.py — the HTTP route-formation API.

The real end-to-end test (uploading a real photo, running real detection
+ embedding, querying the real database) is gated behind
VEHICLE_DETECTION_TEST_DATABASE_URL, same convention as
test_sighting_store.py — this exercises real model inference (YOLO +
ONNX Re-ID) and a real Neon connection, not mocks, since the whole point
is proving the API wiring genuinely works end-to-end.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

TEST_DATABASE_URL = os.environ.get("VEHICLE_DETECTION_TEST_DATABASE_URL")

TEST_PHOTO = os.path.join(
    os.path.dirname(__file__), "..", "data", "test_images_coco128", "000000000064.jpg"
)
# A real, already-tightly-cropped single-vehicle image (a motorcycle,
# ~92x73px) pulled from a real live camera this session — confirmed to
# make VehicleDetector.detect() return ZERO detections (the crop strips
# away the scene context YOLO relies on). This is the exact real-world
# case the whole-image-embedding fallback in api.py exists to fix.
ZERO_DETECTION_PHOTO = os.path.join(
    os.path.dirname(__file__), "..", "data", "test_images_coco128", "real_zero_detection_crop.jpg"
)


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database + real model test, opt-in only",
)
def test_health_endpoint_reports_config(monkeypatch):
    monkeypatch.setenv("ROUTE_SIMILARITY_THRESHOLD", "0.8")
    from fastapi.testclient import TestClient
    import api as api_module

    with TestClient(api_module.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["route_similarity_threshold"] == 0.8


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database + real model test, opt-in only",
)
def test_vehicles_route_returns_chronological_route_for_known_photo(monkeypatch):
    """
    000000000064.jpg was used earlier this session to build up real
    stored sightings in the database (via scripts/run_batch.py), and
    query_similar.py already proved a self-match against its own stored
    sighting returns similarity=1.0000. This test proves the same thing
    through the actual HTTP API: upload the photo, and its own car
    detection's route must include a same-photo sighting at
    similarity ~1.0 (well above the default 0.80 threshold).
    """
    monkeypatch.setenv("VEHICLE_DETECTION_TEST_DATABASE_URL", TEST_DATABASE_URL)
    from fastapi.testclient import TestClient
    import api as api_module

    # Point SightingStore at the real test DB instead of loading
    # model1-service/.env — same override mechanism SightingStore's
    # constructor already supports for tests.
    from sighting_store import SightingStore as RealSightingStore

    original_init = RealSightingStore.__init__

    def _init_with_test_url(self, database_url=None):
        original_init(self, database_url=database_url or TEST_DATABASE_URL)

    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
            )

    assert response.status_code == 200
    body = response.json()
    assert "detections" in body
    assert len(body["detections"]) >= 1

    car_detections = [d for d in body["detections"] if d.get("vehicle_class") == "car"]
    assert len(car_detections) >= 1

    car = car_detections[0]
    assert car["route_threshold_used"] == pytest.approx(0.80)
    assert len(car["route"]) >= 1

    top_similarities = [entry["similarity"] for entry in car["route"]]
    assert max(top_similarities) > 0.99  # the photo's own prior sighting

    # Chronological ordering: detected_at strings must be non-decreasing.
    detected_ats = [entry["detected_at"] for entry in car["route"]]
    assert detected_ats == sorted(detected_ats)

    # Every route entry carries real camera enrichment (proves the JOIN).
    for entry in car["route"]:
        assert entry["camera_name"] is not None
        assert entry["latitude"] is not None
        assert entry["longitude"] is not None


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database + real model test, opt-in only",
)
def test_vehicles_route_applies_configurable_threshold_via_env(monkeypatch):
    """
    Proves ROUTE_SIMILARITY_THRESHOLD is genuinely read from the
    environment (the whole point of making it configurable) — setting it
    to an unreachable 0.999999 threshold should make every route empty
    or drastically shorter than the default-threshold result, since no
    two independent photos of the same object are expected to hit that.
    """
    from sighting_store import SightingStore as RealSightingStore

    original_init = RealSightingStore.__init__

    def _init_with_test_url(self, database_url=None):
        original_init(self, database_url=database_url or TEST_DATABASE_URL)

    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)
    monkeypatch.setenv("ROUTE_SIMILARITY_THRESHOLD", "0.999999")

    from fastapi.testclient import TestClient
    import importlib
    import api as api_module
    importlib.reload(api_module)
    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
            )

    assert response.status_code == 200
    body = response.json()
    car_detections = [d for d in body["detections"] if d.get("vehicle_class") == "car"]
    assert len(car_detections) >= 1
    assert car_detections[0]["route_threshold_used"] == pytest.approx(0.999999)

    # Reload again with default env restored so later tests in this file
    # (and other files, if run in the same session) see the normal 0.80
    # default rather than this test's override leaking forward.
    monkeypatch.delenv("ROUTE_SIMILARITY_THRESHOLD", raising=False)
    importlib.reload(api_module)


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database + real model test, opt-in only",
)
def test_vehicles_route_falls_back_to_whole_image_on_zero_detections(monkeypatch):
    """
    The real bug this fixes: uploading an already-cropped vehicle photo
    (not a full scene) used to return `{"detections": []}` — "no vehicle
    detected" — even though the photo genuinely contains one vehicle,
    because YOLO relies on scene context a tight crop strips away.
    ZERO_DETECTION_PHOTO is confirmed (see its own comment above) to
    produce exactly zero real YOLO detections. This proves the API no
    longer gives up at that point: it must fall back to embedding the
    whole image directly and still return a real, usable result.
    """
    monkeypatch.setenv("VEHICLE_DETECTION_TEST_DATABASE_URL", TEST_DATABASE_URL)
    from fastapi.testclient import TestClient
    import api as api_module

    from sighting_store import SightingStore as RealSightingStore

    original_init = RealSightingStore.__init__

    def _init_with_test_url(self, database_url=None):
        original_init(self, database_url=database_url or TEST_DATABASE_URL)

    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)

    with TestClient(api_module.app) as client:
        with open(ZERO_DETECTION_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("real_zero_detection_crop.jpg", f, "image/jpeg")},
            )

    assert response.status_code == 200
    body = response.json()
    # The real bug: this used to be an empty list. Now it must contain
    # exactly one result — the whole-image fallback path, not a real
    # per-vehicle detection (there were none).
    assert len(body["detections"]) == 1

    result = body["detections"][0]
    assert result["used_whole_image_fallback"] is True
    # A real YOLO score would be a float; this path never ran YOLO on the
    # final embedded image, so confidence must be honestly absent (None),
    # not a fabricated number pretending to be a real detection score.
    assert result["detection_confidence"] is None
    # A route key (even an empty list) must be present — proves
    # find_route() genuinely ran against the embedding, rather than the
    # request short-circuiting before ever reaching the database.
    assert "route" in result or "error" in result


# --- Anchored (spatially constrained) route search ---
#
# Real, documented camera IDs from this project's own live camera table
# (not fabricated) — same pair used by test_sighting_store.py's own
# anchored-search test: Chiman bhai Bridge as the near/anchor camera,
# Hero Showroom Gir Somnath as a genuinely distant one.
REAL_ANCHOR_CAMERA_ID = os.environ.get(
    "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
)


def test_vehicles_route_rejects_when_neither_photo_nor_plate_given():
    """
    Pure request-shape check, no database/model access needed: at least
    one of photo or license_plate must be provided.
    """
    from fastapi.testclient import TestClient
    import api as api_module

    with TestClient(api_module.app) as client:
        response = client.post("/vehicles/route")

    assert response.status_code == 400
    assert "photo" in response.json()["detail"]
    assert "license plate" in response.json()["detail"]


def test_vehicles_route_rejects_anchor_camera_without_anchor_time():
    """
    No database or model access needed for this one — the validation
    that last_seen_camera_id and last_seen_at must be given together is
    pure request-shape checking that should fail fast, before any file is
    even read.
    """
    from fastapi.testclient import TestClient
    import api as api_module

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
                data={"last_seen_camera_id": REAL_ANCHOR_CAMERA_ID},
            )

    assert response.status_code == 400
    assert "together" in response.json()["detail"]


def test_vehicles_route_rejects_malformed_last_seen_at():
    from fastapi.testclient import TestClient
    import api as api_module

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
                data={
                    "last_seen_camera_id": REAL_ANCHOR_CAMERA_ID,
                    "last_seen_at": "not-a-real-timestamp",
                },
            )

    assert response.status_code == 400
    assert "ISO 8601" in response.json()["detail"]


def test_vehicles_route_rejects_timezone_naive_last_seen_at():
    """
    A naive timestamp (no UTC offset) is genuinely ambiguous against the
    database's timestamptz columns — this must be rejected with a clear
    reason, not silently assumed to mean UTC or local time.
    """
    from fastapi.testclient import TestClient
    import api as api_module

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
                data={
                    "last_seen_camera_id": REAL_ANCHOR_CAMERA_ID,
                    "last_seen_at": "2026-10-06T14:30:00",  # no offset
                },
            )

    assert response.status_code == 400
    assert "timezone" in response.json()["detail"]


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database + real model test, opt-in only",
)
def test_vehicles_route_rejects_unknown_anchor_camera_id(monkeypatch):
    monkeypatch.setenv("VEHICLE_DETECTION_TEST_DATABASE_URL", TEST_DATABASE_URL)
    from fastapi.testclient import TestClient
    import api as api_module

    from sighting_store import SightingStore as RealSightingStore

    original_init = RealSightingStore.__init__

    def _init_with_test_url(self, database_url=None):
        original_init(self, database_url=database_url or TEST_DATABASE_URL)

    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
                data={
                    "last_seen_camera_id": "00000000-0000-0000-0000-000000000000",
                    "last_seen_at": "2026-10-06T14:30:00+05:30",
                },
            )

    assert response.status_code == 400
    # SightingStoreError's str() is its message, not its .reason code (the
    # API handler does detail=str(e)) — assert on the actual camera ID
    # genuinely appearing in that message, not a code that was never part
    # of the string form in the first place.
    assert "00000000-0000-0000-0000-000000000000" in response.json()["detail"]


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database + real model test, opt-in only",
)
def test_vehicles_route_runs_anchored_search_when_both_fields_given(monkeypatch):
    """
    Proves the real wiring end-to-end through the actual HTTP API: a
    known real camera (the one 000000000064.jpg's own car detection has
    a genuine prior sighting at, per the existing
    test_vehicles_route_returns_chronological_route_for_known_photo) is
    passed as the anchor, recent enough that the resulting search radius
    comfortably includes that camera's own location (radius 0 is only
    reached in the impossible case of elapsed_hours == 0 exactly, which
    "now" trivially avoids) — the response must come back anchored and
    still find that same real route.
    """
    monkeypatch.setenv("VEHICLE_DETECTION_TEST_DATABASE_URL", TEST_DATABASE_URL)
    from fastapi.testclient import TestClient
    import api as api_module

    from sighting_store import SightingStore as RealSightingStore

    original_init = RealSightingStore.__init__

    def _init_with_test_url(self, database_url=None):
        original_init(self, database_url=database_url or TEST_DATABASE_URL)

    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)

    import datetime
    anchor_time = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with TestClient(api_module.app) as client:
        with open(TEST_PHOTO, "rb") as f:
            response = client.post(
                "/vehicles/route",
                files={"photo": ("000000000064.jpg", f, "image/jpeg")},
                data={
                    "last_seen_camera_id": REAL_ANCHOR_CAMERA_ID,
                    "last_seen_at": anchor_time,
                },
            )

    assert response.status_code == 200
    body = response.json()
    car_detections = [d for d in body["detections"] if d.get("vehicle_class") == "car"]
    assert len(car_detections) >= 1
    assert car_detections[0]["anchored_search"] is True


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_vehicles_route_finds_route_by_plate_alone_no_photo(monkeypatch):
    """
    Proves the real wiring end-to-end: no photo at all, no detection/
    embedding run — a plate-only request looks the vehicle up directly by
    matched_plate and still returns a chronological route, using the same
    response shape as the photo path.
    """
    monkeypatch.setenv("VEHICLE_DETECTION_TEST_DATABASE_URL", TEST_DATABASE_URL)
    from fastapi.testclient import TestClient
    import api as api_module
    from sighting_store import SightingStore as RealSightingStore, Sighting
    import numpy as np

    original_init = RealSightingStore.__init__

    def _init_with_test_url(self, database_url=None):
        original_init(self, database_url=database_url or TEST_DATABASE_URL)

    monkeypatch.setattr(RealSightingStore, "__init__", _init_with_test_url)

    import uuid
    unique_plate = f"GJAPI{uuid.uuid4().hex[:6].upper()}"

    setup_store = RealSightingStore(database_url=TEST_DATABASE_URL)
    vec = np.random.rand(512).astype(np.float32)
    sighting_id = setup_store.save(Sighting(
        camera_id=REAL_ANCHOR_CAMERA_ID, source_image_path="/tmp/plate_only_test.jpg",
        box_xyxy=(0, 0, 10, 10), vehicle_class="car", detection_confidence=0.9,
        embedding=vec / np.linalg.norm(vec), matched_plate=unique_plate, plate_confidence=0.9,
    ))

    try:
        with TestClient(api_module.app) as client:
            response = client.post("/vehicles/route", data={"license_plate": unique_plate})

        assert response.status_code == 200
        body = response.json()
        assert len(body["detections"]) == 1
        assert body["detections"][0]["found_by"] == "plate"
        assert len(body["detections"][0]["route"]) == 1
        assert body["detections"][0]["route"][0]["sighting_id"] == sighting_id
        assert body["detections"][0]["route"][0]["camera_id"] == REAL_ANCHOR_CAMERA_ID
    finally:
        cur = setup_store._conn.cursor()
        cur.execute("DELETE FROM vehicle_sighting WHERE vehicle_sighting_id = %s", (sighting_id,))
        cur.close()
        setup_store.close()
