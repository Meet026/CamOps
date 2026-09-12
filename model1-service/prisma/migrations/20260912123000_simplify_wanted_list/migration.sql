-- Simplifies the wanted-list feature: no CRUD API, no reference-photo/
-- embedding-based auto-matching, no cron job — departments maintain their
-- own wanted list elsewhere; this app only does an exact plate-number
-- check during Vehicle Search and surfaces a notification on a match.
-- No real rows exist yet in any of these tables, so this drops and
-- recreates rather than a column-by-column ALTER.

DROP TABLE IF EXISTS "wanted_match_checkpoint";
DROP TABLE IF EXISTS "wanted_list_notification";
DROP TABLE IF EXISTS "wanted_vehicle";

CREATE TABLE "wanted_vehicle" (
    "wanted_vehicle_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_name" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "crime_details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "department_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "wanted_vehicle_pkey" PRIMARY KEY ("wanted_vehicle_id"),
    CONSTRAINT "wanted_vehicle_status_check" CHECK ("status" IN ('active', 'resolved'))
);

CREATE INDEX "idx_wanted_vehicle_plate_number" ON "wanted_vehicle"("plate_number");
CREATE INDEX "idx_wanted_vehicle_status" ON "wanted_vehicle"("status");

ALTER TABLE "wanted_vehicle" ADD CONSTRAINT "wanted_vehicle_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "wanted_list_notification" (
    "notification_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wanted_vehicle_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "matched_plate_number" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wanted_list_notification_pkey" PRIMARY KEY ("notification_id"),
    CONSTRAINT "wanted_list_notification_source_check" CHECK ("source" IN ('manual_search'))
);

CREATE INDEX "idx_wanted_notification_unread" ON "wanted_list_notification"("is_read", "created_at" DESC);
CREATE INDEX "idx_wanted_notification_wanted_vehicle" ON "wanted_list_notification"("wanted_vehicle_id");

ALTER TABLE "wanted_list_notification" ADD CONSTRAINT "wanted_list_notification_wanted_vehicle_id_fkey" FOREIGN KEY ("wanted_vehicle_id") REFERENCES "wanted_vehicle"("wanted_vehicle_id") ON DELETE CASCADE ON UPDATE CASCADE;
