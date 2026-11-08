-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reviewBasePrice" DECIMAL(12,2);

-- Backfill: existing products use their current price as the review baseline.
UPDATE "Product" SET "reviewBasePrice" = "price" WHERE "reviewBasePrice" IS NULL;
