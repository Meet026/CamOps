"""
Tests for src/wanted_alerts.py — turning a camera's plate read into a
deduplicated wanted-list notification.

Real-database tests are gated behind VEHICLE_DETECTION_TEST_DATABASE_URL
and delete the tagged wanted rows they create (their notifications go with
them via ON DELETE CASCADE).
"""
import os
import socket
import threading
import urllib.parse
import uuid

import pytest

from src.wanted_alerts import WantedAlerter, record_live_alert

TEST_DATABASE_URL = os.environ.get("VEHICLE_DETECTION_TEST_DATABASE_URL")
CAMERA_A = "5f70db74-ef49-4591-99c6-e2db3969884c"  # Visat P2
CAMERA_B = "b04839b4-1598-48cf-a16e-80e2c6d9cb14"  # CN Vidhyalaya


class _FakeWatcher:
    def __init__(self, plates):
        self._plates = plates

    def lookup(self, plate):
        return self._plates.get(plate)

    def status(self):
        return {"plates": len(self._plates), "last_refresh": None, "last_error": None}


class _FakeConn:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


def test_reads_that_are_not_wanted_create_nothing_and_open_no_connection():
    opened = []
    recorded = []
    alerter = WantedAlerter(
        _FakeWatcher({}), connect=lambda: opened.append(1) or _FakeConn(),
        record=lambda *a, **k: recorded.append(a) or True,
    )

    assert alerter.handle("cam-1", [("s-1", "GJ05ZZ9999", 0.9)]) == 0
    assert opened == [] and recorded == []


def test_a_wanted_read_is_recorded_with_the_right_ids():
    recorded = []
    alerter = WantedAlerter(
        _FakeWatcher({"GJ01AB1234": "wv-1"}), connect=_FakeConn,
        record=lambda conn, *a, **k: recorded.append(a) or True,
    )

    assert alerter.handle("cam-1", [("s-1", "GJ01AB1234", 0.82), ("s-2", "GJ05ZZ9999", 0.9)]) == 1
    assert recorded == [("wv-1", "cam-1", "s-1", "GJ01AB1234", 0.82)]
    assert alerter.status()["alerts_created"] == 1


def test_a_deduplicated_read_is_not_counted_as_an_alert():
    alerter = WantedAlerter(
        _FakeWatcher({"GJ01AB1234": "wv-1"}), connect=_FakeConn, record=lambda *a, **k: False,
    )
    assert alerter.handle("cam-1", [("s-1", "GJ01AB1234", 0.82)]) == 0


def test_the_connection_is_closed_even_when_recording_fails():
    conns = []

    def connect():
        conn = _FakeConn()
        conns.append(conn)
        return conn

    def failing_record(*a, **k):
        raise RuntimeError("insert failed")

    alerter = WantedAlerter(_FakeWatcher({"GJ01AB1234": "wv-1"}), connect=connect, record=failing_record)

    # Must not raise: a failed alert can never be allowed to stop ingest.
    assert alerter.handle("cam-1", [("s-1", "GJ01AB1234", 0.82)]) == 0
    assert conns[0].closed
    assert "insert failed" in alerter.status()["last_alert_error"]


def test_a_connection_failure_is_reported_not_raised():
    def connect():
        raise RuntimeError("db unreachable")

    alerter = WantedAlerter(_FakeWatcher({"GJ01AB1234": "wv-1"}), connect=connect, record=lambda *a, **k: True)

    assert alerter.handle("cam-1", [("s-1", "GJ01AB1234", 0.82)]) == 0
    assert "db unreachable" in alerter.status()["last_alert_error"]


def test_status_includes_the_watchers_status():
    alerter = WantedAlerter(_FakeWatcher({"GJ01AB1234": "wv-1"}), connect=_FakeConn, record=lambda *a, **k: True)
    assert alerter.status()["plates"] == 1


# --- real database -------------------------------------------------------

real_db = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)


def _connect():
    import psycopg2

    parsed = urllib.parse.urlparse(TEST_DATABASE_URL)
    ip = socket.getaddrinfo(parsed.hostname, parsed.port or 5432, socket.AF_INET)[0][4][0]
    sep = "&" if parsed.query else "?"
    return psycopg2.connect(f"{TEST_DATABASE_URL}{sep}hostaddr={ip}")


@pytest.fixture
def wanted_vehicle():
    plate = "GJLA" + uuid.uuid4().hex[:6].upper()
    conn = _connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO wanted_vehicle (person_name, plate_number, crime_details) "
        "VALUES ('TEST alerts', %s, 'TEST') RETURNING wanted_vehicle_id",
        (plate,),
    )
    wanted_id = str(cur.fetchone()[0])
    try:
        yield wanted_id, plate
    finally:
        cur.execute("DELETE FROM wanted_vehicle WHERE wanted_vehicle_id = %s", (wanted_id,))
        conn.close()


def _notifications(wanted_id):
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT source, camera_id::text, vehicle_sighting_id::text, seen_at, plate_confidence "
            "FROM wanted_list_notification WHERE wanted_vehicle_id = %s ORDER BY created_at",
            (wanted_id,),
        )
        return cur.fetchall()
    finally:
        conn.close()


def _record(wanted_id, camera_id, plate):
    conn = _connect()
    try:
        return record_live_alert(conn, wanted_id, camera_id, str(uuid.uuid4()), plate, 0.82)
    finally:
        conn.close()


@real_db
def test_first_read_creates_a_camera_live_notification_with_camera_details(wanted_vehicle):
    wanted_id, plate = wanted_vehicle
    assert _record(wanted_id, CAMERA_A, plate) is True

    rows = _notifications(wanted_id)
    assert len(rows) == 1
    source, camera_id, sighting_id, seen_at, confidence = rows[0]
    assert source == "camera_live"
    assert camera_id == CAMERA_A
    assert sighting_id is not None and seen_at is not None
    assert confidence == pytest.approx(0.82)


@real_db
def test_repeat_reads_at_the_same_camera_alert_only_once(wanted_vehicle):
    # A car parked in front of a camera is read every few seconds.
    wanted_id, plate = wanted_vehicle
    assert _record(wanted_id, CAMERA_A, plate) is True
    assert _record(wanted_id, CAMERA_A, plate) is False
    assert _record(wanted_id, CAMERA_A, plate) is False
    assert len(_notifications(wanted_id)) == 1


@real_db
def test_a_different_camera_alerts_again(wanted_vehicle):
    wanted_id, plate = wanted_vehicle
    assert _record(wanted_id, CAMERA_A, plate) is True
    assert _record(wanted_id, CAMERA_B, plate) is True
    assert {row[1] for row in _notifications(wanted_id)} == {CAMERA_A, CAMERA_B}


@real_db
def test_a_resolved_vehicle_never_alerts(wanted_vehicle):
    # The in-memory list can lag a resolve by up to a few seconds; the
    # insert itself must refuse a resolved vehicle.
    wanted_id, plate = wanted_vehicle
    conn = _connect()
    conn.autocommit = True
    conn.cursor().execute("UPDATE wanted_vehicle SET status = 'resolved' WHERE wanted_vehicle_id = %s", (wanted_id,))
    conn.close()

    assert _record(wanted_id, CAMERA_A, plate) is False
    assert _notifications(wanted_id) == []


@real_db
def test_simultaneous_reads_from_both_ingest_loops_alert_exactly_once(wanted_vehicle):
    wanted_id, plate = wanted_vehicle
    results = []
    barrier = threading.Barrier(10)

    def worker():
        conn = _connect()
        try:
            barrier.wait()
            results.append(record_live_alert(conn, wanted_id, CAMERA_A, str(uuid.uuid4()), plate, 0.8))
        finally:
            conn.close()

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(True) == 1
    assert len(_notifications(wanted_id)) == 1


@real_db
def test_a_lookback_alert_also_suppresses_an_immediate_live_alert(wanted_vehicle):
    # If the look-back just alerted on this camera, a live read seconds
    # later is the same event — not a second alert.
    wanted_id, plate = wanted_vehicle
    conn = _connect()
    conn.autocommit = True
    conn.cursor().execute(
        "INSERT INTO wanted_list_notification (wanted_vehicle_id, source, matched_plate_number, camera_id, seen_at) "
        "VALUES (%s, 'camera_lookback', %s, %s, now())",
        (wanted_id, plate, CAMERA_A),
    )
    conn.close()

    assert _record(wanted_id, CAMERA_A, plate) is False


@real_db
def test_a_lookback_about_an_old_sighting_does_not_suppress_a_live_alert_now(wanted_vehicle):
    # Review finding: car seen at X 6h ago -> look-back alert created now;
    # the car passing X again minutes later is a NEW event and must alert.
    wanted_id, plate = wanted_vehicle
    conn = _connect()
    conn.autocommit = True
    conn.cursor().execute(
        "INSERT INTO wanted_list_notification (wanted_vehicle_id, source, matched_plate_number, camera_id, seen_at) "
        "VALUES (%s, 'camera_lookback', %s, %s, now() - interval '6 hours')",
        (wanted_id, plate, CAMERA_A),
    )
    conn.close()

    assert _record(wanted_id, CAMERA_A, plate) is True
