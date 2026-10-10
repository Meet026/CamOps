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
import uuid

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from sighting_store import (
    SightingStore, Sighting, SightingStoreError, _load_database_url,
    filter_plausible_route, _haversine_km, _anchored_search_radius_km,
    TYPICAL_URBAN_SPEED_KMH, MAX_SEARCH_RADIUS_KM, merge_routes,
)


TEST_DATABASE_URL = os.environ.get("VEHICLE_DETECTION_TEST_DATABASE_URL")


def _make_fake_embedding():
    vec = np.random.rand(512).astype(np.float32)
    return vec / np.linalg.norm(vec)


def _delete_sightings(store, sighting_ids):
    # Real-DB tests write to a shared database; each test removes exactly
    # the rows it created so repeated runs stay isolated.
    if not sighting_ids:
        return
    cur = store._conn.cursor()
    try:
        cur.execute(
            "DELETE FROM vehicle_sighting WHERE vehicle_sighting_id = ANY(%s::uuid[])",
            (list(sighting_ids),),
        )
    finally:
        cur.close()


def test_load_database_url_raises_typed_error_when_env_file_missing(tmp_path, monkeypatch):
    # Point the lookup at a location with no model1-service/.env at all.
    import sighting_store as module

    fake_src_dir = tmp_path / "vehicle-detection" / "src"
    fake_src_dir.mkdir(parents=True)
    monkeypatch.setattr(module, "__file__", str(fake_src_dir / "sighting_store.py"))

    with pytest.raises(SightingStoreError) as exc_info:
        _load_database_url()
    assert exc_info.value.reason == "ENV_FILE_MISSING"


def test_sighting_matched_plate_and_confidence_default_to_none():
    # Pure dataclass check, no DB — plate fields are optional and must
    # not force every existing Sighting() construction site (which don't
    # pass them) to start failing.
    sighting = Sighting(
        camera_id="cam-1",
        source_image_path="/tmp/x.jpg",
        box_xyxy=(0, 0, 10, 10),
        vehicle_class="car",
        detection_confidence=0.5,
        embedding=_make_fake_embedding(),
    )
    assert sighting.matched_plate is None
    assert sighting.plate_confidence is None


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
def test_save_persists_matched_plate_and_confidence_when_provided():
    store = SightingStore(database_url=TEST_DATABASE_URL)

    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )

    sighting = Sighting(
        camera_id=real_camera_id,
        source_image_path="/tmp/test_image.jpg",
        box_xyxy=(10, 20, 100, 200),
        vehicle_class="car",
        detection_confidence=0.87,
        embedding=_make_fake_embedding(),
        matched_plate="GJ01AB1234",
        plate_confidence=0.91,
    )

    sighting_id = store.save(sighting)

    try:
        cur = store._conn.cursor()
        cur.execute(
            "SELECT matched_plate, plate_confidence FROM vehicle_sighting WHERE vehicle_sighting_id = %s",
            (sighting_id,),
        )
        row = cur.fetchone()
        cur.close()

        assert row[0] == "GJ01AB1234"
        assert row[1] == pytest.approx(0.91)
    finally:
        _delete_sightings(store, [sighting_id])
        store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_save_leaves_matched_plate_null_when_not_provided():
    # Regression check: a sighting with no plate (the common case today,
    # since plate reading can legitimately fail) must not break the
    # existing save() path or insert a placeholder value.
    store = SightingStore(database_url=TEST_DATABASE_URL)

    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )

    sighting = Sighting(
        camera_id=real_camera_id,
        source_image_path="/tmp/test_image.jpg",
        box_xyxy=(10, 20, 100, 200),
        vehicle_class="car",
        detection_confidence=0.87,
        embedding=_make_fake_embedding(),
    )

    sighting_id = store.save(sighting)

    try:
        cur = store._conn.cursor()
        cur.execute(
            "SELECT matched_plate, plate_confidence FROM vehicle_sighting WHERE vehicle_sighting_id = %s",
            (sighting_id,),
        )
        row = cur.fetchone()
        cur.close()

        assert row[0] is None
        assert row[1] is None
    finally:
        _delete_sightings(store, [sighting_id])
        store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_find_by_plate_returns_sightings_with_that_exact_plate_chronologically():
    store = SightingStore(database_url=TEST_DATABASE_URL)
    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )
    # Unique per run so repeated test runs never collide with a
    # previous run's leftover rows (a real, confirmed problem: a
    # hard-coded plate across runs silently inflated this test's own
    # expected count).
    unique_plate = f"GJTEST{uuid.uuid4().hex[:6].upper()}"
    unrelated_plate = f"GJTEST{uuid.uuid4().hex[:6].upper()}"
    saved_ids = []

    try:
        # Two sightings of the same plate, saved out of chronological
        # order, plus one unrelated plate that must not be returned.
        first_id = store.save(Sighting(
            camera_id=real_camera_id, source_image_path="/tmp/a.jpg",
            box_xyxy=(0, 0, 10, 10), vehicle_class="car", detection_confidence=0.9,
            embedding=_make_fake_embedding(), matched_plate=unique_plate, plate_confidence=0.9,
        ))
        saved_ids.append(first_id)
        second_id = store.save(Sighting(
            camera_id=real_camera_id, source_image_path="/tmp/b.jpg",
            box_xyxy=(0, 0, 10, 10), vehicle_class="car", detection_confidence=0.9,
            embedding=_make_fake_embedding(), matched_plate=unique_plate, plate_confidence=0.9,
        ))
        saved_ids.append(second_id)
        saved_ids.append(store.save(Sighting(
            camera_id=real_camera_id, source_image_path="/tmp/c.jpg",
            box_xyxy=(0, 0, 10, 10), vehicle_class="car", detection_confidence=0.9,
            embedding=_make_fake_embedding(), matched_plate=unrelated_plate, plate_confidence=0.9,
        )))

        route = store.find_by_plate(unique_plate)

        returned_ids = [r["sighting_id"] for r in route]
        assert first_id in returned_ids
        assert second_id in returned_ids
        assert len(route) == 2
        # Chronological order, same contract as find_route.
        detected_times = [r["detected_at"] for r in route]
        assert detected_times == sorted(detected_times)
        # Real bug this caught: psycopg2 returns a literal numeric
        # constant (e.g. `1.0 AS similarity`) as decimal.Decimal, not
        # float -- and Decimal is not JSON-serializable, which only
        # surfaced when the API layer tried to return this route in a
        # response (TypeError: Object of type Decimal is not JSON
        # serializable). isinstance(x, float) is False for a Decimal, so
        # this assertion genuinely catches the regression rather than
        # passing by coincidence.
        assert isinstance(route[0]["similarity"], float)
    finally:
        _delete_sightings(store, saved_ids)
        store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_find_by_plate_normalizes_hyphens_and_case():
    # A real, expected input mismatch: an officer types "GJ-01-AB-1234"
    # or lowercase, while the stored value (from OCR) has no separators
    # and is uppercase. Both must resolve to the same vehicle.
    store = SightingStore(database_url=TEST_DATABASE_URL)
    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )
    suffix = uuid.uuid4().hex[:4].upper()
    stored_plate = f"GJ09TS{suffix}"
    typed_plate = f"gj-09-ts-{suffix.lower()}"
    saved_ids = []

    try:
        sighting_id = store.save(Sighting(
            camera_id=real_camera_id, source_image_path="/tmp/d.jpg",
            box_xyxy=(0, 0, 10, 10), vehicle_class="car", detection_confidence=0.9,
            embedding=_make_fake_embedding(), matched_plate=stored_plate, plate_confidence=0.9,
        ))
        saved_ids.append(sighting_id)

        route = store.find_by_plate(typed_plate)

        assert len(route) == 1
        assert route[0]["sighting_id"] == sighting_id
    finally:
        _delete_sightings(store, saved_ids)
        store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_find_by_plate_returns_empty_list_for_unknown_plate():
    store = SightingStore(database_url=TEST_DATABASE_URL)
    route = store.find_by_plate("GJ99ZZ0000")
    assert route == []
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


# --- _anchored_search_radius_km: pure logic, no database needed, no gate ---


def test_anchored_radius_grows_with_elapsed_time():
    # 5 minutes at the typical urban speed assumption -> a tight radius;
    # 30 minutes -> a proportionally wider one. Real basis for
    # TYPICAL_URBAN_SPEED_KMH: documented mean Indian city traffic speed
    # is ~23-24 km/h (multiple independent studies); 30 km/h is a
    # deliberately generous rounding so a genuine match isn't excluded by
    # assuming traffic is slower than it typically is.
    radius_5min = _anchored_search_radius_km(elapsed_hours=5 / 60)
    radius_30min = _anchored_search_radius_km(elapsed_hours=30 / 60)
    assert radius_5min == pytest.approx(TYPICAL_URBAN_SPEED_KMH * (5 / 60))
    assert radius_30min == pytest.approx(TYPICAL_URBAN_SPEED_KMH * (30 / 60))
    assert radius_30min > radius_5min


def test_anchored_radius_is_capped_for_long_gaps():
    # A 6-hour gap would imply a 180km radius at 30 km/h -- uncapped, that
    # would barely constrain the search at all, defeating the point of
    # this feature. MAX_SEARCH_RADIUS_KM caps it to a realistic
    # city-crossing distance instead.
    radius = _anchored_search_radius_km(elapsed_hours=6.0)
    assert radius == MAX_SEARCH_RADIUS_KM


def test_anchored_radius_rejects_negative_elapsed_time():
    # A candidate sighting timestamped BEFORE the anchor is not a
    # forward-in-time hop at all -- negative elapsed time is a caller
    # bug (or a candidate that should never have been compared this way),
    # not something to silently turn into a negative/zero radius.
    with pytest.raises(ValueError):
        _anchored_search_radius_km(elapsed_hours=-1.0)


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_find_route_from_anchor_excludes_candidates_outside_the_radius():
    store = SightingStore(database_url=TEST_DATABASE_URL)
    real_camera_id = os.environ.get(
        "VEHICLE_DETECTION_TEST_CAMERA_ID", "2ac7d3e2-c1b7-42a8-a588-0acd493db088"
    )

    # A second, real camera genuinely far away (CN Vidhyalaya <-> Suvidha
    # Park is ~108.8km apart, confirmed earlier in this file's own
    # haversine test) is needed to prove the radius actually excludes a
    # distant match. Fall back to skipping the far-camera assertions if
    # that specific camera isn't present in whatever DB this test runs
    # against, rather than silently passing on fabricated IDs.
    far_camera_id = os.environ.get("VEHICLE_DETECTION_TEST_FAR_CAMERA_ID")

    embedding = _make_fake_embedding()
    close_embedding = embedding.copy()
    close_embedding[0] += 0.0001
    close_embedding = close_embedding / np.linalg.norm(close_embedding)

    anchor_time = datetime.datetime.now(datetime.timezone.utc)
    anchor_sighting = Sighting(
        camera_id=real_camera_id, source_image_path="/tmp/anchor_test.jpg",
        box_xyxy=(0, 0, 10, 10), vehicle_class="car",
        detection_confidence=0.9, embedding=embedding,
    )
    nearby_sighting = Sighting(
        camera_id=real_camera_id, source_image_path="/tmp/anchor_test_nearby.jpg",
        box_xyxy=(0, 0, 10, 10), vehicle_class="car",
        detection_confidence=0.9, embedding=close_embedding,
    )

    anchor_id = store.save(anchor_sighting)
    nearby_id = store.save(nearby_sighting)
    far_id = None

    try:
        if far_camera_id:
            far_sighting = Sighting(
                camera_id=far_camera_id, source_image_path="/tmp/anchor_test_far.jpg",
                box_xyxy=(0, 0, 10, 10), vehicle_class="car",
                detection_confidence=0.9, embedding=close_embedding,
            )
            far_id = store.save(far_sighting)

        route = store.find_route_from_anchor(
            embedding=embedding,
            anchor_camera_id=real_camera_id,
            anchor_time=anchor_time,
            similarity_threshold=0.99,
        )
        route_ids = {str(r["sighting_id"]) for r in route}

        assert str(nearby_id) in route_ids
        if far_id:
            assert str(far_id) not in route_ids
    finally:
        ids_to_clean = [anchor_id, nearby_id]
        if far_id:
            ids_to_clean.append(far_id)
        cur = store._conn.cursor()
        cur.execute(
            "DELETE FROM vehicle_sighting WHERE vehicle_sighting_id = ANY(%s::uuid[])",
            (ids_to_clean,),
        )
        cur.close()
        store.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)
def test_find_route_from_anchor_raises_typed_error_for_unknown_camera():
    store = SightingStore(database_url=TEST_DATABASE_URL)

    with pytest.raises(SightingStoreError) as exc_info:
        store.find_route_from_anchor(
            embedding=_make_fake_embedding(),
            anchor_camera_id="00000000-0000-0000-0000-000000000000",
            anchor_time=datetime.datetime.now(datetime.timezone.utc),
            similarity_threshold=0.8,
        )
    assert exc_info.value.reason == "ANCHOR_CAMERA_NOT_FOUND"

    store.close()


def _stop(sid, iso):
    return {"sighting_id": sid, "detected_at": datetime.datetime.fromisoformat(iso)}


def test_merge_routes_keeps_chronological_order_so_last_stop_is_truly_last_seen():
    # Real bug this caught via the live API: plate stops were prepended to
    # the photo route, so a 2026-10-10 plate sighting appeared BEFORE
    # 2026-09-11 photo sightings and the route's last entry reported the
    # wrong "last seen" camera.
    plate = [_stop("p1", "2026-10-10T17:00:14+00:00"), _stop("p2", "2026-10-10T17:00:15+00:00")]
    photo = [_stop("v1", "2026-09-11T09:15:00+00:00"), _stop("v2", "2026-09-11T10:18:00+00:00")]

    merged = merge_routes(plate_route=plate, photo_route=photo)

    assert [s["sighting_id"] for s in merged] == ["v1", "v2", "p1", "p2"]
    assert merged[-1]["sighting_id"] == "p2"


def test_merge_routes_tags_each_stop_with_what_matched_it():
    plate = [_stop("p1", "2026-10-10T10:00:00+00:00")]
    photo = [_stop("v1", "2026-10-10T09:00:00+00:00")]

    merged = merge_routes(plate_route=plate, photo_route=photo)

    assert {s["sighting_id"]: s["matched_by"] for s in merged} == {"v1": "photo", "p1": "plate"}


def test_merge_routes_dedupes_a_sighting_found_by_both_and_marks_it_as_both():
    shared_plate = _stop("s1", "2026-10-10T10:00:00+00:00")
    shared_photo = _stop("s1", "2026-10-10T10:00:00+00:00")

    merged = merge_routes(plate_route=[shared_plate], photo_route=[shared_photo])

    assert len(merged) == 1
    assert merged[0]["matched_by"] == "photo+plate"


def test_merge_routes_with_no_plate_stops_returns_photo_route_unchanged_in_order():
    photo = [_stop("v1", "2026-10-10T09:00:00+00:00"), _stop("v2", "2026-10-10T10:00:00+00:00")]
    merged = merge_routes(plate_route=[], photo_route=photo)
    assert [s["sighting_id"] for s in merged] == ["v1", "v2"]
