ALTER TABLE "vpn_keys"
  ALTER COLUMN "client_group" SET DEFAULT 'direct';

ALTER TABLE "vpn_product_inbounds"
  ALTER COLUMN "client_group" SET DEFAULT 'direct';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vpn_keys" AS legacy
    JOIN "vpn_keys" AS canonical
      ON canonical."subscription_id" = legacy."subscription_id"
     AND canonical."server_id" = legacy."server_id"
     AND canonical."client_group" = 'direct'
    WHERE legacy."client_group" = 'default'
  ) THEN
    RAISE EXCEPTION 'Cannot rename default VPN client groups: a direct key already exists';
  END IF;
END $$;

UPDATE "vpn_keys"
SET "client_group" = 'direct'
WHERE "client_group" = 'default';

UPDATE "vpn_product_inbounds"
SET "client_group" = 'direct'
WHERE "client_group" = 'default';
