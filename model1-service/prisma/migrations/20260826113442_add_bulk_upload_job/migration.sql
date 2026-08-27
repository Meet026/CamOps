/*
  Warnings:

  - Made the column `created_at` on table `app_user` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `audit_log` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `camera` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `camera` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `department` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `refresh_token` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `scoring_verification` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `vendor_lookup` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_department_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey";

-- DropForeignKey
ALTER TABLE "camera" DROP CONSTRAINT "camera_created_by_fkey";

-- DropForeignKey
ALTER TABLE "camera" DROP CONSTRAINT "camera_department_id_fkey";

-- DropForeignKey
ALTER TABLE "camera_status_history" DROP CONSTRAINT "camera_status_history_camera_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_token" DROP CONSTRAINT "refresh_token_user_id_fkey";

-- DropForeignKey
ALTER TABLE "scoring_verification" DROP CONSTRAINT "scoring_verification_camera_id_fkey";

-- DropForeignKey
ALTER TABLE "scoring_verification" DROP CONSTRAINT "scoring_verification_verified_by_fkey";

-- AlterTable
ALTER TABLE "app_user" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "camera" ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "department" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "refresh_token" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "scoring_verification" ALTER COLUMN "created_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "vendor_lookup" ALTER COLUMN "created_at" SET NOT NULL;

-- CreateTable
CREATE TABLE "bulk_upload_job" (
    "job_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_rows" INTEGER NOT NULL,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "succeeded_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "row_errors" JSONB,
    "created_by" UUID,
    "department_scope" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "bulk_upload_job_pkey" PRIMARY KEY ("job_id")
);

-- CreateIndex
CREATE INDEX "idx_bulk_upload_job_created_by" ON "bulk_upload_job"("created_by", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera" ADD CONSTRAINT "camera_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera" ADD CONSTRAINT "camera_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_upload_job" ADD CONSTRAINT "bulk_upload_job_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_upload_job" ADD CONSTRAINT "bulk_upload_job_department_scope_fkey" FOREIGN KEY ("department_scope") REFERENCES "department"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_verification" ADD CONSTRAINT "scoring_verification_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "camera"("camera_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_verification" ADD CONSTRAINT "scoring_verification_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_status_history" ADD CONSTRAINT "camera_status_history_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "camera"("camera_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_audit_log_entity" RENAME TO "audit_log_entity_type_entity_id_idx";

-- RenameIndex
ALTER INDEX "idx_audit_log_user" RENAME TO "audit_log_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_status_history_camera_time" RENAME TO "camera_status_history_camera_id_checked_at_idx";

-- RenameIndex
ALTER INDEX "idx_refresh_token_user" RENAME TO "refresh_token_user_id_idx";

-- RenameIndex
ALTER INDEX "idx_scoring_verification_camera" RENAME TO "scoring_verification_camera_id_idx";

-- RenameIndex
ALTER INDEX "idx_scoring_verification_status" RENAME TO "scoring_verification_status_idx";

-- RenameIndex
ALTER INDEX "idx_vendor_lookup_brand_model" RENAME TO "vendor_lookup_brand_model_pattern_idx";
