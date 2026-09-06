"""
Writes vehicle sightings (detection + embedding) into the vehicle_sighting
table on the existing Neon database. Reuses model1-service's DATABASE_URL
rather than duplicating credentials — same approach as
scripts/setup_database.py.
"""
import math
import os
import socket
import urllib.parse
from dataclasses import dataclass

import numpy as np
import psycopg2

# Real, confirmed bug this constant fixes: find_route() previously ranked
# candidates purely by embedding similarity with zero awareness of time
# or distance, and produced routes implying speeds up to ~1.5 million
# km/h between consecutive stops (measured directly against real,
# already-ingested sighting data this session). 150 km/h is a generous
# ceiling for road vehicles on Indian highways — real max speed limits
# are lower (100-120 km/h on expressways) — chosen deliberately high so
# this filter only rejects genuinely impossible jumps, not merely fast
# ones, and never masks a real match by being too strict.
MAX_PLAUSIBLE_SPEED_KMH = 150.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lng points, in kilometers."""
    r_km = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r_km * math.asin(math.sqrt(a))


def filter_plausible_route(sightings: list[dict], max_speed_kmh: float = MAX_PLAUSIBLE_SPEED_KMH) -> list[dict]:
    """
    Takes a list of sighting dicts already sorted chronologically
    (ascending detected_at — the same order find_route's own SQL query
    already returns) and drops any sighting that would require exceeding
    max_speed_kmh to travel there from the immediately PRECEDING KEPT
    sighting — not the immediately preceding one in the raw input, since
    a rejected sighting must not itself become the (wrong) baseline for
    judging the next one.

    Greedy, not globally optimal: this walks forward once, keeping the
    first sighting always, and for each next candidate either keeps it
    (becomes the new baseline) or drops it (baseline stays where it was).
    A full optimal-subsequence search (e.g. picking whichever kept path
    maximizes total similarity) is real, deferred complexity — not
    needed yet: this tool already labels every result "possible match,
    not confirmed identification" (see the frontend's own copy), so a
    simple, honest greedy filter that at least removes physically
    impossible jumps is the right amount of complexity for what this
    is — a rough route reconstruction aid, not a certified forensic tool.

    Two sightings at the same camera (0 distance) are always plausible
    regardless of elapsed time, including 0 elapsed time (two detections
    in the same processing cycle) — dividing by a near-zero time delta
    would otherwise produce a nonsensical infinite/huge speed for a
    genuinely real, same-place case.
    """
    if not sightings:
        return []

    kept = [sightings[0]]
    for candidate in sightings[1:]:
        prev = kept[-1]
        distance_km = _haversine_km(
            prev["latitude"], prev["longitude"], candidate["latitude"], candidate["longitude"]
        )
        elapsed_hours = (candidate["detected_at"] - prev["detected_at"]).total_seconds() / 3600.0

        if distance_km < 0.05:
            # Same camera / effectively the same real-world point — always
            # plausible, no speed calculation needed (and avoids a
            # divide-by-zero for two same-cycle detections).
            kept.append(candidate)
            continue

        if elapsed_hours <= 0:
            # Non-positive elapsed time with real, nonzero distance is
            # itself impossible (can't be two places at once, and the
            # input is sorted ascending so this shouldn't occur for
            # distinct timestamps) — reject rather than divide by zero.
            continue

        implied_speed_kmh = distance_km / elapsed_hours
        if implied_speed_kmh <= max_speed_kmh:
            kept.append(candidate)
        # else: silently dropped — this candidate is kept out of the
        # returned route, but the original DB row is untouched; a
        # different, later-arriving query could still surface it if it's
        # plausible relative to a different baseline.

    return kept


class SightingStoreError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


@dataclass
class Sighting:
    camera_id: str
    source_image_path: str
    box_xyxy: tuple
    vehicle_class: str
    detection_confidence: float
    embedding: np.ndarray


def _load_database_url() -> str:
    env_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "model1-service", ".env"
    )
    if not os.path.exists(env_path):
        raise SightingStoreError(
            "ENV_FILE_MISSING", f"Could not find model1-service/.env at {env_path}"
        )
    with open(env_path) as f:
        content = f.read()
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL=") and not line.startswith("#"):
            return line.split("=", 1)[1]
    raise SightingStoreError("DATABASE_URL_NOT_FOUND", f"No active DATABASE_URL in {env_path}")


def _connect_preferring_ipv4(database_url: str):
    """
    Some environments (this dev sandbox included) advertise an IPv6 route
    that isn't actually usable — DNS returns AAAA records for Neon's
    hostname, and the OS resolver tries those first, so a plain
    psycopg2.connect(url) hangs for minutes instead of failing fast or
    connecting (confirmed directly: `getent hosts` returns IPv6-only,
    raw IPv6 TCP connect times out, raw IPv4 TCP connect to the same host
    succeeds in <1s). libpq's own DNS resolution isn't reachable through
    Python's socket module, so a Python-level monkeypatch of
    socket.getaddrinfo does not help (proven — it still hung).

    Fix: resolve the hostname to an IPv4 address ourselves and pass it via
    libpq's `hostaddr` parameter, while keeping the original hostname as
    `host` so SSL verification (sslmode=require) still checks the right
    certificate name. This is libpq's documented mechanism for exactly
    this situation, not a workaround specific to this codebase.

    Falls back to a plain connect if IPv4 resolution fails for any reason
    (e.g. a host that genuinely only has an IPv6 address) — this is a
    connectivity nicety, not something that should mask other errors.
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


class SightingStore:
    def __init__(self, database_url: str = None):
        """
        database_url: optional override, used by tests to point at a
        throwaway test database instead of reading model1-service/.env.
        Production/normal usage omits this and reuses Model 1's real
        connection.
        """
        if database_url is None:
            database_url = _load_database_url()
        try:
            self._conn = _connect_preferring_ipv4(database_url)
        except Exception as e:
            raise SightingStoreError("CONNECTION_FAILED", f"Could not connect to database: {e}")
        self._conn.autocommit = True

    def save(self, sighting: Sighting) -> str:
        """
        Inserts one sighting, returns its new vehicle_sighting_id.
        Raises SightingStoreError with a typed reason on failure — e.g. an
        invalid camera_id (foreign key violation) is a real, expected
        failure mode (a caller passing a made-up camera ID), not something
        to silently swallow.
        """
        embedding_list = sighting.embedding.tolist()
        x1, y1, x2, y2 = sighting.box_xyxy

        cur = self._conn.cursor()
        try:
            cur.execute(
                """
                INSERT INTO vehicle_sighting (
                    camera_id, source_image_path,
                    box_x1, box_y1, box_x2, box_y2,
                    vehicle_class, detection_confidence, embedding
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING vehicle_sighting_id;
                """,
                (
                    sighting.camera_id,
                    sighting.source_image_path,
                    x1, y1, x2, y2,
                    sighting.vehicle_class,
                    sighting.detection_confidence,
                    embedding_list,
                ),
            )
            new_id = cur.fetchone()[0]
            return str(new_id)
        except psycopg2.errors.ForeignKeyViolation as e:
            self._conn.rollback()
            raise SightingStoreError(
                "INVALID_CAMERA_ID", f"camera_id {sighting.camera_id!r} does not exist: {e}"
            )
        except Exception as e:
            self._conn.rollback()
            raise SightingStoreError("INSERT_FAILED", f"Could not save sighting: {e}")
        finally:
            cur.close()

    def find_similar(self, embedding: np.ndarray, limit: int = 10) -> list:
        """
        Returns the `limit` most similar stored sightings to the given
        embedding, using pgvector's cosine distance operator (<=>).
        Each result: (vehicle_sighting_id, camera_id, detected_at,
        vehicle_class, similarity) — similarity is 1 - cosine_distance,
        so higher = more similar (matches the convention used throughout
        Phase 0/1's evaluation code).
        """
        embedding_list = embedding.tolist()
        cur = self._conn.cursor()
        try:
            cur.execute(
                """
                SELECT vehicle_sighting_id, camera_id, detected_at, vehicle_class,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM vehicle_sighting
                ORDER BY embedding <=> %s::vector
                LIMIT %s;
                """,
                (embedding_list, embedding_list, limit),
            )
            return cur.fetchall()
        except Exception as e:
            raise SightingStoreError("QUERY_FAILED", f"Similarity search failed: {e}")
        finally:
            cur.close()

    def find_route(
        self,
        embedding: np.ndarray,
        similarity_threshold: float,
        limit: int = 100,
        vehicle_class: str | None = None,
    ) -> list:
        """
        Returns sightings considered "the same vehicle" as the given
        embedding — filtered to similarity >= similarity_threshold, sorted
        CHRONOLOGICALLY (not by similarity, unlike find_similar) so the
        result reads as an actual route: where the vehicle was seen first,
        second, third, etc. Each result is enriched with the sighting's
        real camera name and location, joined from Model 1's existing
        `camera` table (ST_X/ST_Y extraction — same pattern
        model1-service's own camera-registry.service.ts uses for
        PostGIS GEOGRAPHY(POINT) columns, not invented here).

        Returns a list of dicts (not raw tuples, unlike find_similar) —
        this is the shape the API layer serializes directly to JSON.

        NOTE: similarity_threshold is NOT a validated/trustworthy cutoff
        yet — it's a provisional, configurable value (see
        scripts/api.py's ROUTE_SIMILARITY_THRESHOLD env var) documented as
        needing retuning once a better Re-ID model is trained. This method
        applies whatever threshold it's given; it does not judge whether
        that threshold is a good one.

        The similarity-ranked candidates are then run through
        filter_plausible_route() (see its own docstring) — a real,
        confirmed bug this closes: without it, this method could and did
        return routes implying travel at over a million km/h between
        consecutive stops (confirmed directly against real, already-
        ingested sighting data). A physically impossible jump is dropped
        rather than silently presented as a real route segment.
        """
        embedding_list = embedding.tolist()
        cur = self._conn.cursor()
        try:
            # Same-class guard: a car is never a truck. Measured on 150
            # real stored embeddings from one camera, 51 pairs of
            # DIFFERENT vehicle classes still cleared the old 0.80
            # similarity bar — every one of those is unambiguously a
            # false match, and no similarity threshold alone removes
            # them. Filtering in SQL (not post-hoc in Python) means the
            # LIMIT is spent on real candidates instead of being padded
            # with cross-class noise. Skipped when vehicle_class is None
            # so existing callers keep their previous behaviour exactly.
            class_clause = "AND vs.vehicle_class = %s" if vehicle_class else ""
            params = [embedding_list, embedding_list, similarity_threshold]
            if vehicle_class:
                params.append(vehicle_class)
            params.append(limit)

            cur.execute(
                f"""
                SELECT
                    vs.vehicle_sighting_id,
                    vs.camera_id,
                    c.name AS camera_name,
                    ST_Y(c.location_geo::geometry) AS latitude,
                    ST_X(c.location_geo::geometry) AS longitude,
                    vs.detected_at,
                    vs.vehicle_class,
                    1 - (vs.embedding <=> %s::vector) AS similarity
                FROM vehicle_sighting vs
                JOIN camera c ON c.camera_id = vs.camera_id
                WHERE 1 - (vs.embedding <=> %s::vector) >= %s
                {class_clause}
                ORDER BY vs.detected_at ASC
                LIMIT %s;
                """,
                params,
            )
            columns = [
                "sighting_id", "camera_id", "camera_name", "latitude", "longitude",
                "detected_at", "vehicle_class", "similarity",
            ]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
            return filter_plausible_route(rows)
        except Exception as e:
            raise SightingStoreError("QUERY_FAILED", f"Route query failed: {e}")
        finally:
            cur.close()

    def close(self):
        self._conn.close()
