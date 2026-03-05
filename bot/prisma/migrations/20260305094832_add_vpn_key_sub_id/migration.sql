-- AlterTable
ALTER TABLE "vpn_keys" ADD COLUMN     "sub_id" VARCHAR(128);

-- CreateIndex
CREATE INDEX "vpn_keys_sub_id_idx" ON "vpn_keys"("sub_id");
