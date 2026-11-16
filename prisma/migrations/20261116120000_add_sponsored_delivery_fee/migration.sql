-- NEW-08: store-sponsored free-delivery fee (rider still paid, deducted from store payout).
ALTER TABLE "Order" ADD COLUMN "sponsoredDeliveryFee" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Payout" ADD COLUMN "deliveryFeeDeducted" DECIMAL(12,2) NOT NULL DEFAULT 0;
