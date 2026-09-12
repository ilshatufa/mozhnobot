-- AlterTable
ALTER TABLE "users" ADD COLUMN     "clear_access_group_at" TIMESTAMPTZ,
ADD COLUMN     "group_removal_exempt" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "users_group_removal_exempt_clear_access_group_at_idx" ON "users"("group_removal_exempt", "clear_access_group_at");
