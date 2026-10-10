"""
Turns a camera's plate read into a wanted-list notification, at most once
per wanted vehicle per camera every DEDUPE_MINUTES. The notification table
doubles as a durable queue: model1-service already serves it to the
notification bell, and a row written here survives an API outage.
See docs/superpowers/specs/2026-10-10-wanted-plate-camera-alerts-design.md.
"""

DEDUPE_MINUTES = 10

# Serializes concurrent alerts for the same (vehicle, camera) — both ingest
# loops can read the same plate at the same moment — so the NOT EXISTS
# check below can't be raced. Held until the transaction commits.
_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext(%(wv)s || ':' || %(cam)s))"

_INSERT_SQL = """
INSERT INTO wanted_list_notification
  (wanted_vehicle_id, source, matched_plate_number, camera_id, vehicle_sighting_id, seen_at, plate_confidence)
SELECT %(wv)s::uuid, 'camera_live', %(plate)s, %(cam)s::uuid, %(sid)s::uuid, now(), %(conf)s
WHERE EXISTS (
    SELECT 1 FROM wanted_vehicle WHERE wanted_vehicle_id = %(wv)s::uuid AND status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM wanted_list_notification
    WHERE wanted_vehicle_id = %(wv)s::uuid
      AND camera_id = %(cam)s::uuid
      AND source IN ('camera_live', 'camera_lookback')
      AND COALESCE(seen_at, created_at) > now() - make_interval(mins => %(mins)s)
  )
ON CONFLICT DO NOTHING
RETURNING notification_id
"""


def record_live_alert(conn, wanted_vehicle_id, camera_id, sighting_id, plate, confidence,
                      dedupe_minutes=DEDUPE_MINUTES) -> bool:
    """
    Inserts a camera_live notification unless this vehicle already alerted
    from this camera within dedupe_minutes, or is no longer active (the
    in-memory list can lag a resolve by a few seconds). Returns whether a
    notification was created. `conn` must not be in autocommit mode.
    """
    params = {
        "wv": wanted_vehicle_id,
        "cam": camera_id,
        "sid": sighting_id,
        "plate": plate,
        "conf": confidence,
        "mins": dedupe_minutes,
    }
    with conn:  # one transaction: commit on success, rollback on error
        cur = conn.cursor()
        cur.execute(_LOCK_SQL, params)
        cur.execute(_INSERT_SQL, params)
        return cur.fetchone() is not None


class WantedAlerter:
    """Checks a camera's saved plate reads against the in-memory wanted list."""

    def __init__(self, watcher, connect, record=record_live_alert):
        self._watcher = watcher
        self._connect = connect
        self._record = record
        self._alerts_created = 0
        self._last_error = None

    def handle(self, camera_id, saved_plate_reads) -> int:
        created = 0
        for sighting_id, plate, confidence in saved_plate_reads:
            wanted_id = self._watcher.lookup(plate)
            if wanted_id is None:
                continue
            try:
                conn = self._connect()
                try:
                    if self._record(conn, wanted_id, camera_id, sighting_id, plate, confidence):
                        created += 1
                finally:
                    conn.close()
            except Exception as e:  # noqa: BLE001 -- a failed alert must never stop ingest
                self._last_error = f"alert failed: {e}"
        self._alerts_created += created
        return created

    def status(self) -> dict:
        return {
            **self._watcher.status(),
            "alerts_created": self._alerts_created,
            "last_alert_error": self._last_error,
        }
