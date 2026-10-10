"""
Each camera worker's in-memory copy of the active wanted list, so checking
a plate read is a dictionary lookup instead of a database query (the only
way this scales to tens of thousands of cameras).

Kept current two ways:
- LISTEN on the `wanted_list_changed` channel, which the wanted_vehicle
  DB trigger fires on every insert/delete/status change — reload within
  about a second of any change, from any writer.
- A reload every `refresh_seconds` regardless, covering a missed
  notification (worker restarting, network blip).

Plates that passed a camera in the gap before this list updated are caught
separately, by the 24h look-back model1-service runs when a plate is added.
See docs/superpowers/specs/2026-10-10-wanted-plate-camera-alerts-design.md.
"""
import datetime
import re
import select
import threading

_PLATE_SEPARATORS = re.compile(r"[^A-Z0-9]")


def normalize_plate(plate) -> str:
    # Must agree with model1-service's normalizePlateNumber and the plate
    # reader's output: uppercase, no spaces/hyphens/underscores.
    return _PLATE_SEPARATORS.sub("", (plate or "").upper())


def load_active_from_db(connect, conn=None) -> dict:
    """Reads the active list over `conn` if given (left open), else over a
    new connection from `connect` (closed afterwards)."""
    own = conn is None
    if own:
        conn = connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT plate_number, wanted_vehicle_id FROM wanted_vehicle WHERE status = 'active'")
        return {normalize_plate(plate): str(wanted_id) for plate, wanted_id in cur.fetchall()}
    finally:
        if own:
            conn.close()


class WantedPlateWatcher:
    def __init__(self, load_active, listen_connect, refresh_seconds: float = 60.0):
        self._load_active = load_active
        self._listen_connect = listen_connect
        self._refresh_seconds = refresh_seconds
        self._plates: dict = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._last_refresh = None
        self._last_error = None

    def reload(self, conn=None) -> None:
        # Reusing the open LISTEN connection matters: measured against Neon,
        # a fresh connection per reload took ~2.5s vs ~0.23s on an open one.
        try:
            plates = self._load_active(conn) if conn is not None else self._load_active()
        except Exception as e:  # noqa: BLE001 -- keep alerting on the last good list
            self._last_error = f"reload failed: {e}"
            return
        with self._lock:
            self._plates = plates
        self._last_refresh = datetime.datetime.now(datetime.timezone.utc)
        self._last_error = None

    def lookup(self, plate):
        with self._lock:
            return self._plates.get(normalize_plate(plate))

    def status(self) -> dict:
        with self._lock:
            count = len(self._plates)
        return {
            "plates": count,
            "last_refresh": self._last_refresh.isoformat() if self._last_refresh else None,
            "last_error": self._last_error,
        }

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="wanted-watcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        if self._listen_connect is None:
            self.reload()
            while not self._stop.wait(self._refresh_seconds):
                self.reload()
            return

        conn = None
        while not self._stop.is_set():
            try:
                if conn is None:
                    conn = self._listen_connect()
                    conn.autocommit = True
                    conn.cursor().execute("LISTEN wanted_list_changed")
                    # Anything that changed while not listening is picked up here.
                    self._reload_on(conn)
                # psycopg2 moves notifies that arrive during any query (the
                # reload, SELECT 1) into conn.notifies without the socket
                # waking again — handle those before waiting.
                if conn.notifies:
                    conn.notifies.clear()
                    self._reload_on(conn)
                    continue
                # Wake on a notification, at the refresh interval, or within
                # a second of stop() so shutdown isn't held up by a 60s wait.
                ready, _, _ = select.select([conn], [], [], min(self._refresh_seconds, 1.0))
                if ready:
                    conn.poll()
                    if conn.notifies:
                        conn.notifies.clear()
                        self._reload_on(conn)
                        continue
                    # Readable with nothing to read: measured against Neon, a
                    # server-killed connection looks exactly like this (poll()
                    # doesn't raise). Without a real query this loop spins
                    # forever and instant updates silently stop.
                    conn.cursor().execute("SELECT 1")
                if self._due_for_refresh():
                    self._reload_on(conn)
            except Exception as e:  # noqa: BLE001 -- reconnect; never let the watcher die
                self._last_error = f"listen connection lost: {e}"
                try:
                    if conn is not None:
                        conn.close()
                except Exception:  # noqa: BLE001
                    pass
                conn = None
                self._stop.wait(2.0)

        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass

    def _reload_on(self, conn) -> None:
        # reload() swallows errors to keep the last good list; but if the
        # connection itself died mid-reload, raise so _run reconnects
        # instead of carrying on with a dead connection.
        self.reload(conn)
        if conn.closed:
            raise RuntimeError("listen connection closed during reload")

    def _due_for_refresh(self) -> bool:
        if self._last_refresh is None:
            return True
        age = datetime.datetime.now(datetime.timezone.utc) - self._last_refresh
        return age.total_seconds() >= self._refresh_seconds
