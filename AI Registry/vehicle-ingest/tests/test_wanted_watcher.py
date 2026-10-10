"""
Tests for src/wanted_watcher.py — the in-memory copy of the active wanted
list each camera worker keeps, reloaded on LISTEN/NOTIFY and on a timer.

Real-database tests are gated behind VEHICLE_DETECTION_TEST_DATABASE_URL
(same convention as vehicle-detection's tests) and clean up the tagged
wanted rows they insert.
"""
import os
import socket
import time
import urllib.parse
import uuid

import pytest

from src.wanted_watcher import WantedPlateWatcher, load_active_from_db, normalize_plate

TEST_DATABASE_URL = os.environ.get("VEHICLE_DETECTION_TEST_DATABASE_URL")


def _wait_until(predicate, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_normalize_plate_matches_backend_rules():
    assert normalize_plate("gj-01 ab_1234") == "GJ01AB1234"
    assert normalize_plate("") == ""
    assert normalize_plate(None) == ""


def test_lookup_matches_regardless_of_formatting():
    w = WantedPlateWatcher(load_active=lambda: {normalize_plate("gj-01 ab 1234"): "wv-1"}, listen_connect=None)
    w.reload()
    assert w.lookup("GJ01AB1234") == "wv-1"
    assert w.lookup("gj01ab1234") == "wv-1"
    assert w.lookup("GJ05ZZ9999") is None


def test_lookup_before_any_load_finds_nothing():
    w = WantedPlateWatcher(load_active=lambda: {"GJ01AB1234": "wv-1"}, listen_connect=None)
    assert w.lookup("GJ01AB1234") is None


def test_failed_reload_keeps_the_last_good_list_and_reports_the_error():
    calls = iter([{"GJ01AB1234": "wv-1"}, RuntimeError("db down")])

    def load():
        value = next(calls)
        if isinstance(value, Exception):
            raise value
        return value

    w = WantedPlateWatcher(load_active=load, listen_connect=None)
    w.reload()
    w.reload()

    assert w.lookup("GJ01AB1234") == "wv-1"
    assert "db down" in w.status()["last_error"]
    assert w.status()["plates"] == 1


def test_successful_reload_clears_a_previous_error():
    calls = iter([RuntimeError("db down"), {"GJ01AB1234": "wv-1"}])

    def load():
        value = next(calls)
        if isinstance(value, Exception):
            raise value
        return value

    w = WantedPlateWatcher(load_active=load, listen_connect=None)
    w.reload()
    w.reload()

    assert w.status()["last_error"] is None
    assert w.status()["last_refresh"] is not None


def test_periodic_refresh_picks_up_a_new_plate_without_any_notify():
    lists = [{}, {"GJ01AB1234": "wv-1"}]
    state = {"loads": 0}

    def load():
        value = lists[min(state["loads"], 1)]
        state["loads"] += 1
        return value

    w = WantedPlateWatcher(load_active=load, listen_connect=None, refresh_seconds=0.05)
    w.start()
    try:
        assert _wait_until(lambda: w.lookup("GJ01AB1234") == "wv-1", timeout=2)
    finally:
        w.stop()


def test_stop_ends_the_background_thread():
    w = WantedPlateWatcher(load_active=lambda: {}, listen_connect=None, refresh_seconds=0.05)
    w.start()
    w.stop()
    assert not w._thread.is_alive()


class _DeadButReadableConnection:
    """Mimics a LISTEN connection the server has killed: the socket stays
    readable, poll() does not raise and reports no notifications, but any
    real query fails — measured behaviour of psycopg2 against Neon."""

    def __init__(self):
        import socket as _socket
        self._a, self._b = _socket.socketpair()
        self._b.send(b"x")  # permanently readable
        self.notifies = []
        self.autocommit = False
        self.closed = 0

    def fileno(self):
        return self._a.fileno()

    def poll(self):
        pass

    def cursor(self):
        conn = self

        class _Cursor:
            def execute(self, sql, *args):
                if sql.strip().upper().startswith("LISTEN"):
                    return
                raise RuntimeError("server closed the connection")

        return _Cursor()

    def close(self):
        self._a.close()
        self._b.close()


class _NotifyingConnection(_DeadButReadableConnection):
    """A healthy LISTEN connection that delivers one notification."""

    def __init__(self):
        super().__init__()
        self._delivered = False

    def poll(self):
        if not self._delivered:
            self._delivered = True
            self.notifies.append(object())
            self._a.recv(1)  # drain so the socket goes quiet afterwards


def test_reload_after_a_notify_reuses_the_open_listen_connection():
    # Measured: opening a fresh connection per reload took ~2.5s against
    # Neon vs ~0.23s on the already-open LISTEN connection.
    listen = _NotifyingConnection()
    seen = []

    def load_active(conn=None):
        seen.append(conn)
        return {}

    w = WantedPlateWatcher(load_active=load_active, listen_connect=lambda: listen, refresh_seconds=60)
    w.start()
    try:
        assert _wait_until(lambda: len(seen) >= 2, timeout=3)
        assert all(conn is listen for conn in seen)
    finally:
        w.stop()


def test_a_listen_connection_that_dies_during_a_reload_is_replaced():
    connects = []

    def connect():
        conn = _NotifyingConnection()
        connects.append(conn)
        return conn

    def load_active(conn=None):
        if conn is connects[0] and conn._delivered:
            conn.closed = 2  # what psycopg2 sets when the server drops it mid-query
            raise RuntimeError("server closed the connection unexpectedly")
        return {}

    w = WantedPlateWatcher(load_active=load_active, listen_connect=connect, refresh_seconds=60)
    w.start()
    try:
        assert _wait_until(lambda: len(connects) >= 2, timeout=6), "kept using a dead connection"
    finally:
        w.stop()


def test_a_notify_that_arrives_during_a_reload_is_not_stranded():
    # Review finding: psycopg2 moves notifies into conn.notifies while a
    # query runs, so the socket never wakes for them again.
    listen = _NotifyingConnection()
    loads = []

    def load_active(conn=None):
        loads.append(1)
        if len(loads) == 2:  # the reload triggered by the first notify
            conn.notifies.append(object())  # a second change lands mid-reload
        return {"P": str(len(loads))}

    w = WantedPlateWatcher(load_active=load_active, listen_connect=lambda: listen, refresh_seconds=60)
    w.start()
    try:
        assert _wait_until(lambda: len(loads) >= 3, timeout=3), "second change waited for the 60s refresh"
    finally:
        w.stop()


def test_a_dead_but_readable_listen_connection_is_replaced_not_spun_on():
    connects = []

    def connect():
        conn = _DeadButReadableConnection()
        connects.append(conn)
        return conn

    w = WantedPlateWatcher(load_active=lambda: {}, listen_connect=connect, refresh_seconds=60)
    w.start()
    try:
        assert _wait_until(lambda: len(connects) >= 2, timeout=5), "watcher spun on a dead connection instead of reconnecting"
        assert "listen connection lost" in w.status()["last_error"]
    finally:
        w.stop()


# --- real database -------------------------------------------------------


def _connect():
    import psycopg2

    parsed = urllib.parse.urlparse(TEST_DATABASE_URL)
    ip = socket.getaddrinfo(parsed.hostname, parsed.port or 5432, socket.AF_INET)[0][4][0]
    sep = "&" if parsed.query else "?"
    return psycopg2.connect(f"{TEST_DATABASE_URL}{sep}hostaddr={ip}")


def _insert_wanted(plate):
    conn = _connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO wanted_vehicle (person_name, plate_number, crime_details) "
        "VALUES ('TEST watcher', %s, 'TEST') RETURNING wanted_vehicle_id",
        (plate,),
    )
    wanted_id = str(cur.fetchone()[0])
    conn.close()
    return wanted_id


def _delete_wanted(plate):
    conn = _connect()
    conn.autocommit = True
    conn.cursor().execute("DELETE FROM wanted_vehicle WHERE plate_number = %s", (plate,))
    conn.close()


real_db = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="requires VEHICLE_DETECTION_TEST_DATABASE_URL — real database test, opt-in only",
)


@real_db
def test_new_wanted_plate_arrives_by_notify_not_by_refresh():
    plate = "GJTW" + uuid.uuid4().hex[:6].upper()
    # 60s refresh: if the plate shows up within 3s it came from NOTIFY.
    w = WantedPlateWatcher(load_active=lambda conn=None: load_active_from_db(_connect, conn), listen_connect=_connect, refresh_seconds=60)
    w.start()
    try:
        assert _wait_until(lambda: w.status()["last_refresh"] is not None, timeout=10)
        wanted_id = _insert_wanted(plate)
        assert _wait_until(lambda: w.lookup(plate) == wanted_id, timeout=3)

        _delete_wanted(plate)
        assert _wait_until(lambda: w.lookup(plate) is None, timeout=3)
    finally:
        w.stop()
        _delete_wanted(plate)


@real_db
def test_resolved_plate_drops_out_of_the_list():
    plate = "GJTW" + uuid.uuid4().hex[:6].upper()
    w = WantedPlateWatcher(load_active=lambda conn=None: load_active_from_db(_connect, conn), listen_connect=_connect, refresh_seconds=60)
    w.start()
    try:
        wanted_id = _insert_wanted(plate)
        assert _wait_until(lambda: w.lookup(plate) == wanted_id, timeout=5)

        conn = _connect()
        conn.autocommit = True
        conn.cursor().execute("UPDATE wanted_vehicle SET status='resolved' WHERE wanted_vehicle_id=%s", (wanted_id,))
        conn.close()

        assert _wait_until(lambda: w.lookup(plate) is None, timeout=3)
    finally:
        w.stop()
        _delete_wanted(plate)


@real_db
def test_watcher_reconnects_after_the_listen_connection_is_killed():
    plate = "GJTW" + uuid.uuid4().hex[:6].upper()
    server_pids = []

    def tracking_connect():
        # psycopg2's get_backend_pid() reports the Neon proxy's id, not the
        # server process — pg_terminate_backend on it is a silent no-op.
        # Ask the server for its real pid before the watcher uses the conn.
        conn = _connect()
        cur = conn.cursor()
        cur.execute("SELECT pg_backend_pid()")
        server_pids.append(cur.fetchone()[0])
        conn.rollback()
        return conn

    w = WantedPlateWatcher(load_active=lambda conn=None: load_active_from_db(_connect, conn), listen_connect=tracking_connect, refresh_seconds=60)
    w.start()
    try:
        assert _wait_until(lambda: len(server_pids) == 1 and w.status()["last_refresh"] is not None, timeout=10)

        killer = _connect()
        killer.autocommit = True
        cur = killer.cursor()
        cur.execute("SELECT pg_terminate_backend(%s)", (server_pids[0],))
        assert cur.fetchone()[0] is True, "test setup: the LISTEN connection was not actually killed"
        killer.close()

        assert _wait_until(lambda: len(server_pids) >= 2, timeout=15), "watcher never reconnected"
        time.sleep(0.5)  # let the new LISTEN register

        wanted_id = _insert_wanted(plate)
        assert _wait_until(lambda: w.lookup(plate) == wanted_id, timeout=5)
    finally:
        w.stop()
        _delete_wanted(plate)


def test_normalize_plate_keeps_only_letters_and_digits():
    assert normalize_plate("GJ.01/AB_1234") == "GJ01AB1234"
