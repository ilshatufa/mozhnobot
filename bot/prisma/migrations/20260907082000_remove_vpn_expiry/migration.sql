ALTER TABLE "vpn_keys"
ALTER COLUMN "expires_at" DROP NOT NULL;

UPDATE "vpn_keys"
SET "expires_at" = NULL;
