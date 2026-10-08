"""
Database Sighting Retriever.

Generates and executes SQL queries against PostgreSQL `vehicle_sighting` table.
Supports attribute matching (color, type, make, model), plate ILIKE regex, camera IDs,
and time windows, returning real camera latitude and longitude from PostGIS.
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

from ..database.connection import get_db_connection
from ..schemas.search import ParsedQuery, DateRangeFilter

logger = logging.getLogger(__name__)


def retrieve_candidate_sightings(
    parsed: ParsedQuery,
    camera_ids: Optional[List[str]] = None,
    limit: int = 100
) -> List[Dict[str, Any]]:
    """Fetches candidate vehicle sightings matching structured filters from PostgreSQL."""
    
    def _build_and_execute(strict: bool) -> List[Dict[str, Any]]:
        conditions = ["1=1"]
        params: List[Any] = []

        # 1. Color filter
        if parsed.color:
            conditions.append("s.vehicle_color ILIKE %s")
            params.append(f"%{parsed.color}%")

        # 2. Vehicle type / class filter
        if parsed.vehicle_type:
            conditions.append("(s.vehicle_type ILIKE %s OR s.vehicle_class ILIKE %s)")
            params.extend([f"%{parsed.vehicle_type}%", f"%{parsed.vehicle_type}%"])

        # 3. Make filter
        if parsed.make:
            conditions.append("s.vehicle_make ILIKE %s")
            params.append(f"%{parsed.make}%")

        # 4. Model filter
        if parsed.model:
            conditions.append("s.vehicle_model_name ILIKE %s")
            params.append(f"%{parsed.model}%")

        # 5. Plate pattern matching
        if parsed.plate_pattern:
            clean_plate = parsed.plate_pattern.replace("-", "").replace(" ", "")
            conditions.append("(s.matched_plate ILIKE %s OR REPLACE(COALESCE(s.matched_plate, ''), '-', '') ILIKE %s)")
            params.extend([f"%{parsed.plate_pattern}%", f"%{clean_plate}%"])

        # 6. Camera ID filtering
        if camera_ids and len(camera_ids) > 0 and strict:
            conditions.append("s.camera_id::text = ANY(%s)")
            params.append(camera_ids)

        # 7. Time range filter
        if parsed.time_range:
            if parsed.time_range.start_time:
                conditions.append("s.detected_at >= %s")
                params.append(parsed.time_range.start_time)
            if parsed.time_range.end_time:
                conditions.append("s.detected_at <= %s")
                params.append(parsed.time_range.end_time)

        where_clause = " AND ".join(conditions)

        sql = f"""
            SELECT 
                s.vehicle_sighting_id::text AS id,
                s.camera_id::text AS camera_id,
                COALESCE(c.name, 'Camera ' || s.camera_id::text) AS camera_name,
                c.address_text AS camera_location,
                ST_Y(c.location_geo::geometry) AS latitude,
                ST_X(c.location_geo::geometry) AS longitude,
                s.detected_at AS timestamp,
                s.matched_plate AS license_plate,
                COALESCE(s.plate_confidence, 0.92) AS plate_confidence,
                COALESCE(s.vehicle_type, s.vehicle_class, 'car') AS vehicle_type,
                s.vehicle_color AS color,
                s.vehicle_make AS make,
                s.vehicle_model_name AS model,
                s.source_image_path AS crop_url,
                s.source_image_path AS full_frame_url
            FROM vehicle_sighting s
            LEFT JOIN camera c ON s.camera_id = c.camera_id
            WHERE {where_clause}
            ORDER BY s.detected_at DESC
            LIMIT %s;
        """
        params.append(limit)

        records = []
        try:
            conn = get_db_connection()
            with conn.cursor() as cur:
                cur.execute(sql, params)
                columns = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                for r in rows:
                    records.append(dict(zip(columns, r)))
            conn.close()
        except Exception as e:
            logger.error(f"Failed to execute candidate retrieval SQL ({e}).")

        return records

    # 1. Execute strict query
    results = _build_and_execute(strict=True)

    # 2. If no results found with strict camera filter, try relaxing the camera filter
    if not results and camera_ids:
        logger.info("Strict camera filter returned 0 results; relaxing camera filter...")
        results = _build_and_execute(strict=False)

    # 3. If still no results and multiple criteria were specified, try matching model OR color
    if not results and (parsed.model or parsed.color):
        logger.info("Specific combination returned 0 results; running broad fallback...")
        conditions = []
        params = []
        if parsed.model:
            conditions.append("s.vehicle_model_name ILIKE %s")
            params.append(f"%{parsed.model}%")
        if parsed.color:
            conditions.append("s.vehicle_color ILIKE %s")
            params.append(f"%{parsed.color}%")
        if conditions:
            where_clause = " OR ".join(conditions)
            sql = f"""
                SELECT 
                    s.vehicle_sighting_id::text AS id,
                    s.camera_id::text AS camera_id,
                    COALESCE(c.name, 'Camera ' || s.camera_id::text) AS camera_name,
                    c.address_text AS camera_location,
                    ST_Y(c.location_geo::geometry) AS latitude,
                    ST_X(c.location_geo::geometry) AS longitude,
                    s.detected_at AS timestamp,
                    s.matched_plate AS license_plate,
                    COALESCE(s.plate_confidence, 0.92) AS plate_confidence,
                    COALESCE(s.vehicle_type, s.vehicle_class, 'car') AS vehicle_type,
                    s.vehicle_color AS color,
                    s.vehicle_make AS make,
                    s.vehicle_model_name AS model,
                    s.source_image_path AS crop_url,
                    s.source_image_path AS full_frame_url
                FROM vehicle_sighting s
                LEFT JOIN camera c ON s.camera_id = c.camera_id
                WHERE {where_clause}
                ORDER BY s.detected_at DESC
                LIMIT %s;
            """
            params.append(limit)
            try:
                conn = get_db_connection()
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                    columns = [desc[0] for desc in cur.description]
                    for r in cur.fetchall():
                        results.append(dict(zip(columns, r)))
                conn.close()
            except Exception as e:
                logger.error(f"Fallback retrieval failed: {e}")

    return results
