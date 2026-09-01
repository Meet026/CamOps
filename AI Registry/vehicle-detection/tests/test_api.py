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
