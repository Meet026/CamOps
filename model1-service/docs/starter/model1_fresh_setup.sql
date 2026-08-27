-- ============================================================================
-- Model 1 — Fresh Database Setup
-- Step 1: Clean up old tables (if you ran the previous script inside the
--         default `postgres` database) → Step 2: Create a dedicated database
--         → Step 3: Build all tables inside that new database
-- ============================================================================
--
-- STATUS: one-time historical setup script. This file established the
-- initial schema. From this point forward, `npx prisma migrate dev` is the
-- single source of truth for ALL schema changes — do not hand-edit the
-- database, and do not re-run this script once real (non-seed) data exists,
-- since SECTION 1/2 drop the database outright.
--
-- HOW TO RUN THIS FILE:
--
-- If you're using psql (command line):
--   Just run the whole file top to bottom — the \c command below will
--   automatically switch your connection to the new database partway through.
--     psql -U postgres -f model1_fresh_setup.sql
--
-- If you're using pgAdmin, DBeaver, or another GUI tool:
--   \c is a psql-only shortcut and won't work in those tools. Instead:
--     1. Run SECTION 1 and SECTION 2 while connected to your default
--        'postgres' database.
--     2. Then manually switch/open a new connection to the
--        'sentinel_model1_db' database you just created.
--     3. Then run SECTION 3 onward while connected to that new database.
--
-- ============================================================================


-- ============================================================================
-- SECTION 1: Clean up — drop old tables if they exist in the current database
-- ============================================================================
-- Dropped in reverse dependency order (children before parents), with CASCADE
-- as a safety net in case any indexes/constraints still reference them.

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS camera_status_history CASCADE;
DROP TABLE IF EXISTS scoring_verification CASCADE;
DROP TABLE IF EXISTS vendor_lookup CASCADE;
DROP TABLE IF EXISTS refresh_token CASCADE;
DROP TABLE IF EXISTS camera CASCADE;
DROP TABLE IF EXISTS app_user CASCADE;
DROP TABLE IF EXISTS department CASCADE;


-- ============================================================================
-- SECTION 2: Create a dedicated database for this project
-- ============================================================================
-- NOTE: CREATE DATABASE cannot run inside a transaction block, and this
-- command must be run while connected to a DIFFERENT database (like the
-- default 'postgres' one) — you can't be "inside" the database you're
-- creating. That's normal Postgres behavior, not a mistake in this script.

DROP DATABASE IF EXISTS sentinel_model1_db;
CREATE DATABASE sentinel_model1_db;

-- Switch the connection into the new database (psql-only command).
-- Everything below this line will now run INSIDE sentinel_model1_db.
\c sentinel_model1_db


-- ============================================================================
-- SECTION 3: Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS postgis;    -- for GEOGRAPHY type + spatial queries

-- OPTIONAL — uncomment only if TimescaleDB is installed on your system.
-- CREATE EXTENSION IF NOT EXISTS timescaledb;


-- ============================================================================
-- SECTION 4: Core Tables (Department, Users)
-- ============================================================================

CREATE TABLE department (
    department_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    code            TEXT UNIQUE NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE app_user (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL
                    CHECK (role IN ('admin', 'field_officer', 'dept_viewer', 'auditor')),
    department_id   UUID REFERENCES department(department_id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Refresh tokens — enables short-lived access tokens (15 min) with a
-- revocable 7-day refresh flow. Tokens are stored HASHED (sha256/bcrypt),
-- never in plaintext, so a DB leak alone doesn't hand out valid tokens.
-- Logout / revocation = delete the row.
CREATE TABLE refresh_token (
    token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_refresh_token_user ON refresh_token (user_id);


-- ============================================================================
-- SECTION 5: Camera Registry (the core table)
-- ============================================================================

CREATE TABLE camera (
    camera_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id        UUID NOT NULL REFERENCES department(department_id),
    name                 TEXT NOT NULL,
    location_geo         GEOGRAPHY(POINT, 4326) NOT NULL,
    address_text         TEXT,
    camera_type          TEXT NOT NULL
                         CHECK (camera_type IN ('analog', 'ip')),
    brand                TEXT,
    model                TEXT,
    onvif_status         TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (onvif_status IN ('yes', 'no', 'unknown')),
    onvif_source         TEXT
                         CHECK (onvif_source IN ('lookup_table', 'ai_guess', 'user_confirmed') OR onvif_source IS NULL),
    integration_score    TEXT NOT NULL DEFAULT 'needs_verification'
                         CHECK (integration_score IN ('easy', 'medium', 'hard', 'needs_verification')),
    data_confidence      TEXT NOT NULL DEFAULT 'self_reported'
                         CHECK (data_confidence IN ('verified_in_person', 'verified_api', 'self_reported')),
    photo_url            TEXT,
    -- Health-monitoring target, all nullable/optional: most field officers
    -- won't know this at onboarding time, and that's fine — same "unknown
    -- is a valid state" philosophy as onvif_status. If ip_address is NULL,
    -- the health-check cron simply skips the camera (current_status stays
    -- 'unknown') instead of erroring. A later, IT-capable person can fill
    -- these in. Model 1 only does a basic TCP port reachability check here —
    -- a full RTSP handshake/stream validation is Model 2's job, not this one.
    ip_address           INET,
    rtsp_port            INTEGER,
    stream_path          TEXT,
    current_status       TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (current_status IN ('online', 'offline', 'unknown')),
    installed_at         DATE,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_by           UUID REFERENCES app_user(user_id),
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now(),
    -- Bulk-upload idempotency: re-uploading the same CSV should update the
    -- existing row for a given department+name pair rather than creating a
    -- duplicate camera. Enforced here so it holds even outside the bulk-
    -- upload code path (e.g. two concurrent manual submissions).
    CONSTRAINT uq_camera_department_name UNIQUE (department_id, name)
);

CREATE INDEX idx_camera_location ON camera USING GIST (location_geo);
CREATE INDEX idx_camera_department ON camera (department_id);
CREATE INDEX idx_camera_integration_score ON camera (integration_score);
CREATE INDEX idx_camera_is_active ON camera (is_active);


-- ============================================================================
-- SECTION 6: Integration Scoring Support Tables
-- ============================================================================

CREATE TABLE vendor_lookup (
    lookup_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand           TEXT NOT NULL,
    model_pattern   TEXT NOT NULL,
    onvif_status    TEXT NOT NULL
                    CHECK (onvif_status IN ('yes', 'no')),
    sdk_available   BOOLEAN DEFAULT false,
    source          TEXT
                    CHECK (source IN ('official_datasheet', 'community', 'ai_verified')),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vendor_lookup_brand_model ON vendor_lookup (brand, model_pattern);

CREATE TABLE scoring_verification (
    verification_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id            UUID NOT NULL REFERENCES camera(camera_id),
    ai_suggested_onvif    TEXT,
    ai_confidence_note    TEXT,
    verified_by           UUID REFERENCES app_user(user_id),
    verified_at            TIMESTAMPTZ,
    final_onvif_status     TEXT,
    status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'rejected')),
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scoring_verification_status ON scoring_verification (status);
CREATE INDEX idx_scoring_verification_camera ON scoring_verification (camera_id);


-- ============================================================================
-- SECTION 7: Health Monitoring
-- ============================================================================

-- id is a surrogate BIGSERIAL primary key, not (camera_id, checked_at).
-- Two health checks landing in the same millisecond under concurrent cron
-- execution isn't actually impossible, and a composite key that silently
-- collides is worse to debug later than one boring auto-increment column.
CREATE TABLE camera_status_history (
    id                 BIGSERIAL PRIMARY KEY,
    camera_id          UUID NOT NULL REFERENCES camera(camera_id),
    status             TEXT NOT NULL
                       CHECK (status IN ('online', 'offline')),
    checked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    response_time_ms   INTEGER
);

CREATE INDEX idx_status_history_camera_time ON camera_status_history (camera_id, checked_at DESC);

-- OPTIONAL — only if you enabled timescaledb in SECTION 3.
-- SELECT create_hypertable('camera_status_history', 'checked_at');


-- ============================================================================
-- SECTION 8: Audit Log
-- ============================================================================

CREATE TABLE audit_log (
    audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES app_user(user_id),
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at DESC);


-- ============================================================================
-- SECTION 9a: Bulk Upload Job (added — CSV bulk upload background job tracking)
-- ============================================================================
-- NOTE: this table was actually added to the live database via
-- `npx prisma migrate dev`, not by re-running this script — this section
-- exists purely so the file stays an accurate historical record of the full
-- schema. Per the project's schema policy (see PRD Section 6), this script
-- must not be re-run against a database with real data.

CREATE TABLE bulk_upload_job (
    job_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_rows        INTEGER NOT NULL,
    processed_rows    INTEGER NOT NULL DEFAULT 0,
    succeeded_count   INTEGER NOT NULL DEFAULT 0,
    failed_count      INTEGER NOT NULL DEFAULT 0,
    row_errors        JSONB,
    created_by        UUID REFERENCES app_user(user_id),
    department_scope  UUID REFERENCES department(department_id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_bulk_upload_job_created_by ON bulk_upload_job (created_by, created_at DESC);


-- ============================================================================
-- SECTION 9: Seed Data
-- ============================================================================

INSERT INTO department (name, code) VALUES
    ('Home Department (Police)', 'HOME'),
    ('Regional Transport Office', 'RTO'),
    ('Food & Civil Supplies', 'FCS'),
    ('Municipal Corporation', 'MUNI'),
    ('Health Department', 'HEALTH');

INSERT INTO app_user (email, password_hash, role) VALUES
    ('admin@sentinel.local', '$2b$10$replaceThisWithARealBcryptHashLater', 'admin');

INSERT INTO vendor_lookup (brand, model_pattern, onvif_status, sdk_available, source) VALUES
    ('Hikvision', 'DS-2CD2%', 'yes', true, 'official_datasheet'),
    ('Dahua', 'IPC-HFW%', 'yes', true, 'official_datasheet'),
    ('CP Plus', 'CP-UNC%', 'yes', false, 'official_datasheet');


-- ============================================================================
-- Done. Sanity checks:
-- ============================================================================
-- SELECT current_database();          -- should print 'sentinel_model1_db'
-- SELECT * FROM department;
-- SELECT * FROM vendor_lookup;
-- SELECT postgis_version();
-- ============================================================================
