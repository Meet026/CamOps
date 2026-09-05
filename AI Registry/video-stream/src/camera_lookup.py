"""
Reads camera metadata (name, RTSP stream_path) from Model 1's existing
camera table. This project has no database of its own — it reuses
model1-service's DATABASE_URL directly, the same way vehicle-detection
does (see AI Registry/vehicle-detection/src/sighting_store.py), rather
than duplicating credentials or building a second registry.

Read-only: this module never writes to the camera table.
"""
import os
import socket
import urllib.parse

import psycopg2


class CameraLookupError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


def _connect_preferring_ipv4(database_url: str):
    """
    Deliberately duplicated from vehicle-detection/src/sighting_store.py
    rather than imported from it — importing that module directly pulls
    in its full dependency graph (numpy, psycopg2, the vehicle-sighting
    dataclass) for the sake of this one small connection helper, coupling
    two independently-deployed services together over one function. This
    project is small enough that a deliberate, commented duplication is
    the more honest choice than a cross-service import for convenience.

    Why this function exists at all: this dev sandbox advertises an IPv6
    route that isn't actually usable — DNS returns AAAA records for
    Neon's hostname, and the OS resolver tries those first, so a plain
    psycopg2.connect(url) hangs instead of connecting or failing fast
    (confirmed directly, same diagnosis as sighting_store.py's own
    docstring). Fix: resolve the hostname to IPv4 ourselves and pass it
    via libpq's `hostaddr` parameter, keeping the original hostname as
    `host` so TLS verification still checks the right certificate name —
    libpq's own documented mechanism for exactly this situation.
    """
    parsed = urllib.parse.urlparse(database_url)
    hostname = parsed.hostname
    port = parsed.port or 5432
    try:
        ipv4_addr = socket.getaddrinfo(hostname, port, socket.AF_INET)[0][4][0]
    except (socket.gaierror, TypeError, IndexError):
        return psycopg2.connect(database_url)

    separator = "&" if parsed.query else "?"
    return psycopg2.connect(f"{database_url}{separator}hostaddr={ipv4_addr}")


def _load_database_url() -> str:
    env_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "model1-service", ".env"
    )
    if not os.path.exists(env_path):
        raise CameraLookupError(
            "ENV_FILE_MISSING", f"Could not find model1-service/.env at {env_path}"
        )
    with open(env_path) as f:
        content = f.read()
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL=") and not line.startswith("#"):
            return line.split("=", 1)[1]
    raise CameraLookupError("DATABASE_URL_NOT_FOUND", f"No active DATABASE_URL in {env_path}")


class CameraLookup:
    def __init__(self, database_url: str = None):
        """
        database_url: optional override, used by tests to point at a
        throwaway test database instead of reading model1-service/.env.
        """
        if database_url is None:
            database_url = _load_database_url()
        try:
            self._conn = _connect_preferring_ipv4(database_url)
        except Exception as e:
            raise CameraLookupError("CONNECTION_FAILED", f"Could not connect to database: {e}")
        self._conn.autocommit = True

    def get_stream_path(self, camera_id: str) -> str | None:
        """
        Returns the camera's RTSP stream_path, or None if the camera
        doesn't exist or has no stream_path set. Never raises for a
        missing/unset camera — that's a real, expected outcome the
        caller (the streaming endpoint) turns into a 404, not an error
        condition here.
        """
        cur = self._conn.cursor()
        try:
            cur.execute(
                "SELECT stream_path FROM camera WHERE camera_id = %s::uuid;",
                (camera_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None
        except Exception as e:
            raise CameraLookupError("QUERY_FAILED", f"Camera lookup failed: {e}")
        finally:
            cur.close()

    def list_streamable_cameras(self) -> list[dict]:
        """
        Every camera with a real stream_path set — what a future grid
        frontend's camera picker would list. Ordered by name for a
        stable, predictable listing.
        """
        cur = self._conn.cursor()
        try:
            cur.execute(
                """
                SELECT camera_id, name, stream_path
                FROM camera
                WHERE stream_path IS NOT NULL
                ORDER BY name;
                """
            )
            columns = ["camera_id", "name", "stream_path"]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            raise CameraLookupError("QUERY_FAILED", f"Camera listing failed: {e}")
        finally:
            cur.close()

    def close(self):
        self._conn.close()
