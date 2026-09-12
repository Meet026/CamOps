-- AlterTable: add TOTP two-factor auth columns to app_user
ALTER TABLE "app_user" ADD COLUMN "totp_secret" TEXT;
ALTER TABLE "app_user" ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_user" ADD COLUMN "totp_enabled_at" TIMESTAMPTZ;

-- CreateTable: one-time-use backup recovery codes
CREATE TABLE "totp_backup_code" (
    "backup_code_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_backup_code_pkey" PRIMARY KEY ("backup_code_id")
);

-- CreateIndex
CREATE INDEX "totp_backup_code_user_id_idx" ON "totp_backup_code"("user_id");

-- AddForeignKey
ALTER TABLE "totp_backup_code" ADD CONSTRAINT "totp_backup_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
