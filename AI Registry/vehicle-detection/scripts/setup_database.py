#!/usr/bin/env python3
"""
One-time setup: enables pgvector on the existing Neon database (the same
one model1-service already uses — DATABASE_URL is read from
model1-service/.env, not duplicated here) and creates the vehicle_sighting
table.

Real, verified facts before writing this (not assumed):
- pgvector is officially supported on Neon, enabled via a plain
  `CREATE EXTENSION IF NOT EXISTS vector;` — no special Neon configuration
  needed (confirmed via Neon's own docs).
- The existing `camera` table's primary key is `camera_id`, type UUID
  (confirmed directly from model1-service/prisma/schema.prisma).

Schema follows the original research doc's Phase 2 design
(Ai Idea Research.md, Part 3): vehicle_sighting_id, camera_id (FK),
timestamp, cropped_image_url, embedding_vector, matched_plate (nullable),
plate_confidence, visual_confidence — with camera_id/class/confidence
fields added for what the detector actually produces.
"""
import os
import re

import psycopg2


def _load_database_url() -> str:
    """
    Reads DATABASE_URL from model1-service/.env — this project doesn't
    duplicate that credential, it reuses Model 1's existing Neon instance.
    """
    env_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "model1-service", ".env"
    )
    if not os.path.exists(env_path):
        raise FileNotFoundError(
            f"Could not find model1-service/.env at {env_path} — this "
            f"script reuses Model 1's existing database connection rather "
            f"than duplicating credentials."
        )
    with open(env_path) as f:
        content = f.read()
    # Match the real, active DATABASE_URL line (not a commented-out one —
    # model1-service/.env keeps a commented local-postgres alternative
    # alongside the real Neon URL, see the file's own content).
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL=") and not line.startswith("#"):
            return line.split("=", 1)[1]
    raise ValueError(f"No active DATABASE_URL line found in {env_path}")


def setup_database() -> None:
    database_url = _load_database_url()
    conn = psycopg2.connect(database_url)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    print("pgvector extension enabled.")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS vehicle_sighting (
            vehicle_sighting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            camera_id UUID NOT NULL REFERENCES camera(camera_id),
            detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            source_image_path TEXT NOT NULL,
            box_x1 INT NOT NULL,
            box_y1 INT NOT NULL,
            box_x2 INT NOT NULL,
            box_y2 INT NOT NULL,
            vehicle_class TEXT NOT NULL,
            detection_confidence REAL NOT NULL,
            embedding VECTOR(512) NOT NULL,
            matched_plate TEXT,
            plate_confidence REAL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    print("vehicle_sighting table ready.")

    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_vehicle_sighting_camera
        ON vehicle_sighting(camera_id);
        """
    )
    # ivfflat is an APPROXIMATE index — pgvector's own docs note it tunes
    # better once real data exists (lists should scale with row count).
    # lists=100 is a reasonable small-scale default for Phase 2's test
    # data volume; revisit if this grows into real production data.
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_vehicle_sighting_embedding
        ON vehicle_sighting USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
        """
    )
    print("Indexes ready (camera_id, ivfflat cosine similarity on embedding).")

    cur.close()
    conn.close()


if __name__ == "__main__":
    setup_database()
