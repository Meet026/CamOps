"""
Tests for src/sighting_store.py.

The real-database tests (SightingStore against an actual Postgres/Neon
connection) are gated behind the VEHICLE_DETECTION_TEST_DATABASE_URL
env var, same convention Phase 0 used for tests needing the real model
file — skipped by default so the test suite doesn't require live
database access, opt-in when actually verifying against a real instance.
"""
import datetime
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from sighting_store import (
    SightingStore, Sighting, SightingStoreError, _load_database_url,
    filter_plausible_route, _haversine_km,
)


TEST_DATABASE_URL = os.environ.get("VEHICLE_DETECTION_TEST_DATABASE_URL")


def _make_fake_embedding():
    vec = np.random.rand(512).astype(np.float32)
    return vec / np.linalg.norm(vec)


def test_load_database_url_raises_typed_error_when_env_file_missing(tmp_path, monkeypatch):
    # Point the lookup at a location with no model1-service/.env at all.
    import sighting_store as module

    fake_src_dir = tmp_path / "vehicle-detection" / "src"
    fake_src_dir.mkdir(parents=True)
    monkeypatch.setattr(module, "__file__", str(fake_src_dir / "sighting_store.py"))

    with pytest.raises(SightingStoreError) as exc_info:
        _load_database_url()
    assert exc_info.value.reason == "ENV_FILE_MISSING"


def test_connection_failure_raises_typed_error():
    with pytest.raises(SightingStoreError) as exc_info:
        SightingStore(database_url="postgresql://invalid:invalid@localhost:1/nonexistent")
    assert exc_info.value.reason == "CONNECTION_FAILED"


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_save_and_find_similar_round_trip():
    store = SightingStore(database_url=TEST_DATABASE_URL)

    # A real camera_id must already exist in the camera table for this to
    # succeed — using one of the cameras registered earlier this session
    # (Chiman bhai Bridge). If this specific ID doesn't exist in whatever
    # database TEST_DATABASE_URL points at, this test will correctly fail
    # with INVALID_CAMERA_ID rather than silently pass against fake data.
    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )

    embedding = _make_fake_embedding()
    sighting = Sighting(
        camera_id=real_camera_id,
        source_image_path="/tmp/test_image.jpg",
        box_xyxy=(10, 20, 100, 200),
        vehicle_class="car",
        detection_confidence=0.87,
        embedding=embedding,
    )

    sighting_id = store.save(sighting)
    assert sighting_id is not None

    results = store.find_similar(embedding, limit=5)
    assert len(results) >= 1
    # The sighting we just saved should be its own top (or near-top) match.
    top_match_id = str(results[0][0])
    assert top_match_id == sighting_id

    store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_save_with_invalid_camera_id_raises_typed_error():
    store = SightingStore(database_url=TEST_DATABASE_URL)

    sighting = Sighting(
        camera_id="00000000-0000-0000-0000-000000000000",  # does not exist
        source_image_path="/tmp/test_image.jpg",
        box_xyxy=(10, 20, 100, 200),
        vehicle_class="car",
        detection_confidence=0.5,
        embedding=_make_fake_embedding(),
    )

    with pytest.raises(SightingStoreError) as exc_info:
        store.save(sighting)
    assert exc_info.value.reason == "INVALID_CAMERA_ID"

    store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_find_route_filters_by_threshold_and_sorts_chronologically():
    store = SightingStore(database_url=TEST_DATABASE_URL)
    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )

    # Two "same vehicle" sightings (near-identical embeddings, so both
    # clear a high threshold) and one "different vehicle" sighting (a
    # genuinely different random embedding, so it should NOT clear the
    # threshold) — proves find_route actually filters, not just returns
    # everything.
    base_embedding = _make_fake_embedding()
    close_embedding = base_embedding.copy()
    close_embedding[0] += 0.0001  # tiny perturbation, still ~1.0 similarity
    close_embedding = close_embedding / np.linalg.norm(close_embedding)
    different_embedding = _make_fake_embedding()

    sighting_a = Sighting(
        camera_id=real_camera_id, source_image_path="/tmp/route_test_a.jpg",
        box_xyxy=(0, 0, 10, 10), vehicle_class="car",
        detection_confidence=0.9, embedding=base_embedding,
    )
    sighting_b = Sighting(
        camera_id=real_camera_id, source_image_path="/tmp/route_test_b.jpg",
        box_xyxy=(0, 0, 10, 10), vehicle_class="car",
        detection_confidence=0.9, embedding=close_embedding,
    )
    sighting_c_different = Sighting(
        camera_id=real_camera_id, source_image_path="/tmp/route_test_c.jpg",
        box_xyxy=(0, 0, 10, 10), vehicle_class="car",
        detection_confidence=0.9, embedding=different_embedding,
    )

    id_a = store.save(sighting_a)
    id_b = store.save(sighting_b)
    id_c = store.save(sighting_c_different)

    try:
        route = store.find_route(base_embedding, similarity_threshold=0.99, limit=100)
        route_ids = {r["sighting_id"] for r in route}

        assert str(id_a) in route_ids or id_a in route_ids
        assert str(id_b) in route_ids or id_b in route_ids
        # The genuinely different embedding must NOT clear a 0.99 threshold
        # against random 512-dim vectors (real, checkable math — two
        # independent random unit vectors in 512 dimensions have
        # essentially zero chance of exceeding 0.99 cosine similarity).
        assert str(id_c) not in route_ids and id_c not in route_ids

        # Every returned entry has the real camera name/location joined in
        # (not None) — proves the JOIN against the real camera table works.
        for entry in route:
            assert entry["camera_name"] is not None
            assert entry["latitude"] is not None
            assert entry["longitude"] is not None
    finally:
        cur = store._conn.cursor()
        cur.execute(
            "DELETE FROM vehicle_sighting WHERE vehicle_sighting_id IN (%s, %s, %s)",
            (id_a, id_b, id_c),
        )
        cur.close()
        store.close()


# --- filter_plausible_route: pure logic, no database needed, no gate ---


def _sighting(name: str, lat: float, lng: float, minutes_offset: int) -> dict:
    base = datetime.datetime(2026, 9, 5, 8, 0, 0, tzinfo=datetime.timezone.utc)
    return {
        "sighting_id": name,
        "camera_name": name,
        "latitude": lat,
        "longitude": lng,
        "detected_at": base + datetime.timedelta(minutes=minutes_offset),
        "vehicle_class": "car",
        "similarity": 0.85,
    }


def test_haversine_matches_known_real_distance():
    # CN Vidhyalaya -> Suvidha Park, real coordinates from this project's
    # own camera table (looked up directly, not guessed, and cross-checked
    # against this session's own earlier independent calculation of this
    # exact pair, which also got ~108.8km).
    d = _haversine_km(23.020556, 72.551667, 22.3850051, 71.745261)
    assert 107 < d < 110  # real straight-line distance is ~108.8km


def test_filter_keeps_a_single_sighting():
    route = [_sighting("A", 23.0, 72.5, 0)]
    assert filter_plausible_route(route) == route


def test_filter_keeps_realistic_consecutive_stops():
    # ~11km apart (Visat P2 -> CN Vidhyalaya, real distance measured this
    # session), 2 hours apart -- a perfectly ordinary driving speed.
    route = [
        _sighting("Visat P2", 23.1193, 72.5657, 0),
        _sighting("CN Vidhyalaya", 23.0206, 72.5517, 120),
    ]
    result = filter_plausible_route(route)
    assert len(result) == 2


def test_filter_drops_the_real_impossible_jump_this_bug_report_found():
    # The exact real case measured this session against this project's
    # actual, already-ingested data: CN Vidhyalaya -> Hero Showroom Gir
    # Somnath, 18 SECONDS apart, implying ~1.5 million km/h -- confirmed
    # impossible. (Hero Showroom Gir Somnath's real coordinates in this
    # project's own camera table are (0, 0) -- itself a separate, real
    # data-quality issue, an unresolved-geocode placeholder, not
    # something this filter fixes -- but it's exactly the case this
    # filter must correctly reject regardless of WHY the jump looks
    # impossible.) The baseline for judging the NEXT candidate must
    # remain the last genuinely KEPT stop (CN Vidhyalaya), not the
    # rejected one.
    route = [
        _sighting("CN Vidhyalaya", 23.020556, 72.551667, 0),
        _sighting("Hero Showroom Gir Somnath", 0.0, 0.0, 0.3),  # 18s later
        _sighting("Suvidha Park", 22.3850051, 71.745261, 60),  # a real, plausible stop from CN Vidhyalaya's baseline
    ]
    result = filter_plausible_route(route)
    kept_names = [r["camera_name"] for r in result]
    assert kept_names == ["CN Vidhyalaya", "Suvidha Park"]


def test_filter_treats_same_camera_as_always_plausible_regardless_of_time_gap():
    # Two detections at the exact same camera, one second apart -- a real,
    # ordinary case (two vehicles/frames processed in the same cycle),
    # must never be rejected as "impossible speed" (which a naive
    # distance/time division would compute as 0/~0 -> NaN or a spurious
    # huge number depending on floating-point rounding).
    route = [
        _sighting("CN Vidhyalaya", 23.020556, 72.551667, 0),
        _sighting("CN Vidhyalaya", 23.020556, 72.551667, 1 / 60),  # 1 second later
    ]
    result = filter_plausible_route(route)
    assert len(result) == 2


def test_filter_respects_custom_max_speed():
    # 100km apart in 1 hour = 100km/h -- plausible at the default 150
    # ceiling, but must be rejected under a stricter, explicitly-passed
    # 80 km/h ceiling -- proves max_speed_kmh is a real, honored parameter,
    # not a hardcoded value with a dead argument.
    route = [
        _sighting("A", 22.0, 72.0, 0),
        _sighting("B", 22.9, 72.0, 60),  # ~100km north, 60 min later
    ]
    assert len(filter_plausible_route(route, max_speed_kmh=150.0)) == 2
    assert len(filter_plausible_route(route, max_speed_kmh=80.0)) == 1
