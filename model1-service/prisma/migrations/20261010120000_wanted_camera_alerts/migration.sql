-- Camera-originated wanted-list alerts (see the 2026-10-10 spec).
ALTER TABLE "wanted_list_notification"
  ADD COLUMN "camera_id" UUID,
  ADD COLUMN "vehicle_sighting_id" UUID,
  ADD COLUMN "seen_at" TIMESTAMPTZ,
  ADD COLUMN "plate_confidence" DOUBLE PRECISION;

-- vehicle_sighting is owned by the AI Registry services (not Prisma), so no
-- FK to it; camera is Prisma-owned.
ALTER TABLE "wanted_list_notification" ADD CONSTRAINT "wanted_list_notification_camera_id_fkey"
  FOREIGN KEY ("camera_id") REFERENCES "camera"("camera_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dedupe lookups: "did this vehicle already alert from this camera recently?"
CREATE INDEX "idx_wanted_notification_dedupe"
  ON "wanted_list_notification"("wanted_vehicle_id", "camera_id", "created_at" DESC);

-- One alert per sighting, ever — protects look-back and live from double-inserting.
CREATE UNIQUE INDEX "uq_wanted_notification_sighting"
  ON "wanted_list_notification"("wanted_vehicle_id", "vehicle_sighting_id")
  WHERE "vehicle_sighting_id" IS NOT NULL;

-- A plate can be active at most once; re-adding after resolve is allowed.
CREATE UNIQUE INDEX "uq_wanted_vehicle_active_plate"
  ON "wanted_vehicle"("plate_number") WHERE "status" = 'active';

-- Instant push to ingest workers for ANY writer (this app or a department sync).
CREATE OR REPLACE FUNCTION notify_wanted_list_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('wanted_list_changed', COALESCE(NEW.wanted_vehicle_id, OLD.wanted_vehicle_id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wanted_vehicle_changed"
  AFTER INSERT OR DELETE OR UPDATE OF "status", "plate_number" ON "wanted_vehicle"
  FOR EACH ROW EXECUTE FUNCTION notify_wanted_list_changed();
