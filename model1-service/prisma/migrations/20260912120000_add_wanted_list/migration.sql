-- CreateTable: wanted_vehicle — a flagged person + vehicle, with an
-- optional reference-photo embedding for automatic camera-sighting
-- matching (pgvector, same shape as AI Registry's vehicle_sighting.embedding).
--
-- SUPERSEDED by migration 20260912123000_simplify_wanted_list, which drops
-- and recreates these tables without the reference-photo/embedding columns
-- and without wanted_match_checkpoint — the auto-matching design this
-- migration was built for was dropped in favor of exact plate-number
-- matching only. Kept here unmodified for migration-history integrity
-- (this file genuinely ran against the live DB before being superseded).
CREATE TABLE "wanted_vehicle" (
    "wanted_vehicle_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_name" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "crime_details" TEXT NOT NULL,
    "reference_photo_url" TEXT,
    "reference_embedding" vector(512),
    "status" TEXT NOT NULL DEFAULT 'active',
    "department_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "wanted_vehicle_pkey" PRIMARY KEY ("wanted_vehicle_id"),
    CONSTRAINT "wanted_vehicle_status_check" CHECK ("status" IN ('active', 'resolved'))
);

CREATE INDEX "idx_wanted_vehicle_plate_number" ON "wanted_vehicle"("plate_number");
CREATE INDEX "idx_wanted_vehicle_status" ON "wanted_vehicle"("status");

ALTER TABLE "wanted_vehicle" ADD CONSTRAINT "wanted_vehicle_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wanted_vehicle" ADD CONSTRAINT "wanted_vehicle_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: wanted_list_notification — one row per surfaced match,
-- either a manual plate-typed search or the automatic camera-sighting cron.
CREATE TABLE "wanted_list_notification" (
    "notification_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wanted_vehicle_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "sighting_id" UUID,
    "camera_id" UUID,
    "similarity_score" DOUBLE PRECISION,
    "matched_plate_number" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wanted_list_notification_pkey" PRIMARY KEY ("notification_id"),
    CONSTRAINT "wanted_list_notification_source_check" CHECK ("source" IN ('manual_search', 'auto_camera_match'))
);

CREATE INDEX "idx_wanted_notification_unread" ON "wanted_list_notification"("is_read", "created_at" DESC);
CREATE INDEX "idx_wanted_notification_wanted_vehicle" ON "wanted_list_notification"("wanted_vehicle_id");

ALTER TABLE "wanted_list_notification" ADD CONSTRAINT "wanted_list_notification_wanted_vehicle_id_fkey" FOREIGN KEY ("wanted_vehicle_id") REFERENCES "wanted_vehicle"("wanted_vehicle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: wanted_match_checkpoint — single-row watermark for the
-- WantedMatchCron polling job (id is always 1).
CREATE TABLE "wanted_match_checkpoint" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_checked_sighting_created_at" TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wanted_match_checkpoint_pkey" PRIMARY KEY ("id")
);

INSERT INTO "wanted_match_checkpoint" ("id", "last_checked_sighting_created_at") VALUES (1, '1970-01-01T00:00:00Z');
