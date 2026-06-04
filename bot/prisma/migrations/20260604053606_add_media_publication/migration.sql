-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaProcessingStatus" ADD VALUE 'PUBLISHING';
ALTER TYPE "MediaProcessingStatus" ADD VALUE 'PUBLISHED';

-- AlterTable
ALTER TABLE "media_processing_jobs" ADD COLUMN     "published_at" TIMESTAMPTZ,
ADD COLUMN     "published_message_id" INTEGER;
