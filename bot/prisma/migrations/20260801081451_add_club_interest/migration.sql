-- CreateTable
CREATE TABLE "club_interest" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waitlisted_at" TIMESTAMPTZ,

    CONSTRAINT "club_interest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_interest_user_id_key" ON "club_interest"("user_id");

-- AddForeignKey
ALTER TABLE "club_interest" ADD CONSTRAINT "club_interest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
