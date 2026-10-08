"""
Schema migration: adds vehicle attribute columns, VL embedding, and
model versioning to the existing vehicle_sighting table.

Safety guarantees:
- ALL new columns are nullable → existing rows stay valid
- Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS → safe to re-run
- Does NOT modify or drop any existing column
- The existing image-search (embedding <=> query) keeps working unchanged

Run:
    python -m scripts.migrate_schema
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.database.connection import connect


MIGRATION_SQL = """
-- =================================================================
-- Vehicle Search — Schema Migration
-- Adds attribute, VL embedding, and model versioning columns to
-- the existing vehicle_sighting table.
-- All columns are nullable; existing rows remain valid.
-- =================================================================

-- 1. Vehicle attributes
ALTER TABLE vehicle_sighting
    ADD COLUMN IF NOT EXISTS vehicle_type       TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_make       TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_model_name TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_color      TEXT;

-- 2. Attribute confidence scores
ALTER TABLE vehicle_sighting
    ADD COLUMN IF NOT EXISTS vehicle_type_confidence  REAL,
    ADD COLUMN IF NOT EXISTS vehicle_make_confidence   REAL,
    ADD COLUMN IF NOT EXISTS vehicle_model_confidence  REAL,
    ADD COLUMN IF NOT EXISTS vehicle_color_confidence  REAL;

-- 3. Vision-language embedding (separate from reid embedding)
--    768 dimensions = SigLIP 2 Base default
ALTER TABLE vehicle_sighting
    ADD COLUMN IF NOT EXISTS vl_embedding  vector(768);

-- 4. Model versioning — so future model upgrades don't silently mix
--    incompatible embeddings in the same index
ALTER TABLE vehicle_sighting
    ADD COLUMN IF NOT EXISTS embedding_model    TEXT,
    ADD COLUMN IF NOT EXISTS embedding_version  TEXT;

-- 5. Indexes for attribute-based filtering
--    These are used by the structured filtering stage of hybrid search.
CREATE INDEX IF NOT EXISTS idx_vs_vehicle_color
    ON vehicle_sighting (vehicle_color);

CREATE INDEX IF NOT EXISTS idx_vs_vehicle_make
    ON vehicle_sighting (vehicle_make);

CREATE INDEX IF NOT EXISTS idx_vs_vehicle_model_name
    ON vehicle_sighting (vehicle_model_name);

CREATE INDEX IF NOT EXISTS idx_vs_vehicle_type
    ON vehicle_sighting (vehicle_type);

-- 6. HNSW index on VL embedding for fast ANN search
--    cosine_ops matches the SigLIP 2 embedding space.
--    Only created if pgvector extension is available (it already is,
--    since the existing reid embedding column uses vector type).
CREATE INDEX IF NOT EXISTS idx_vs_vl_embedding_hnsw
    ON vehicle_sighting
    USING hnsw (vl_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 7. Composite index for time + camera filtering (common query pattern)
CREATE INDEX IF NOT EXISTS idx_vs_camera_detected_at
    ON vehicle_sighting (camera_id, detected_at DESC);
"""


def run_migration():
    print("Connecting to database...")
    conn = connect()
    cur = conn.cursor()
    try:
        print("Running vehicle_sighting schema migration...")
        cur.execute(MIGRATION_SQL)
        conn.commit()
        print("Migration completed successfully.")

        # Verify: list the columns
        cur.execute("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'vehicle_sighting'
            ORDER BY ordinal_position;
        """)
        print("\nvehicle_sighting columns after migration:")
        for col_name, col_type in cur.fetchall():
            print(f"  {col_name:30s}  {col_type}")

    except Exception as e:
        conn.rollback()
        print(f"Migration FAILED: {e}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_migration()
