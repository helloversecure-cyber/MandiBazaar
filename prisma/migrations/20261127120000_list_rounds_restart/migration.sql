-- Item lists restart for a new offer round when the customer hasn't accepted an
-- offer in the window (owner rule: 48 h). Additive: new columns with defaults,
-- so every existing list, broadcast and offer is round 1.

-- AlterEnum: offers left pending when a round's window ends (kept for records).
ALTER TYPE "StoreBidStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "ItemList" ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "roundStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ListBroadcast" ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StoreBid" ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "listMaxRounds" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "listExpiryHours" SET DEFAULT 48;

-- Owner rule: the window is 48 h. Move the settings row off the old 24 h default
-- (an admin who chose another value keeps it).
UPDATE "StoreSettings" SET "listExpiryHours" = 48 WHERE "listExpiryHours" = 24;

-- One offer per store per list per round (was per list). Every existing row is
-- round 1, so the new index holds before the old one is dropped.
CREATE UNIQUE INDEX "StoreBid_listId_storeId_round_key" ON "StoreBid"("listId", "storeId", "round");

-- DropIndex
DROP INDEX "StoreBid_listId_storeId_key";
