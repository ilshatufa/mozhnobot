-- CreateEnum
CREATE TYPE "ClubSearchRequestMode" AS ENUM ('CLUB', 'WEB');

-- AlterTable
ALTER TABLE "club_search_requests" ADD COLUMN     "mode" "ClubSearchRequestMode" NOT NULL DEFAULT 'CLUB',
ADD COLUMN     "web_sources" JSONB NOT NULL DEFAULT '[]';
