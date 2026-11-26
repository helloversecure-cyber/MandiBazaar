-- CreateEnum
CREATE TYPE "DeliveryRequestTrigger" AS ENUM ('CHECKOUT', 'POST_PACK');

-- CreateEnum
CREATE TYPE "ItemListStatus" AS ENUM ('BIDDING', 'ACCEPTED', 'CANCELLED', 'NO_STORES', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StoreBidStatus" AS ENUM ('PENDING', 'ACCEPTED', 'NOT_SELECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

-- AlterTable
ALTER TABLE "DeliveryRequest" ADD COLUMN     "city" TEXT,
ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trigger" "DeliveryRequestTrigger" NOT NULL DEFAULT 'CHECKOUT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryCodeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryCodeHash" TEXT,
ADD COLUMN     "deliveryCodeLockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "lastLatitude" DOUBLE PRECISION,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "lastLongitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "listBiddingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "listExpiryHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "listMaxStores" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "listRadiusMaxKm" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "listRadiusStartKm" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "listRadiusStepKm" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "listRadiusStepMins" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "postPackBidWindowSecs" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "postPackRiderRadiusKm" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "ItemList" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ItemListStatus" NOT NULL DEFAULT 'BIDDING',
    "addressSnapshot" JSONB NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "city" TEXT NOT NULL,
    "note" TEXT,
    "radiusKm" INTEGER NOT NULL DEFAULT 5,
    "lastWidenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "acceptedBidId" TEXT,
    "orderId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemListLine" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "categoryId" TEXT,
    "productId" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemListLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListBroadcast" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "radiusKm" INTEGER NOT NULL,
    "distanceKm" DECIMAL(8,3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),

    CONSTRAINT "ListBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreBid" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "StoreBidStatus" NOT NULL DEFAULT 'PENDING',
    "itemsTotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "prepMinutes" INTEGER,
    "note" TEXT,
    "coveredCount" INTEGER NOT NULL,
    "listVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreBidLine" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL,
    "unitPrice" DECIMAL(12,2),

    CONSTRAINT "StoreBidLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreReview" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileRefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemList_acceptedBidId_key" ON "ItemList"("acceptedBidId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemList_orderId_key" ON "ItemList"("orderId");

-- CreateIndex
CREATE INDEX "ItemList_customerId_idx" ON "ItemList"("customerId");

-- CreateIndex
CREATE INDEX "ItemList_status_city_idx" ON "ItemList"("status", "city");

-- CreateIndex
CREATE INDEX "ItemList_expiresAt_idx" ON "ItemList"("expiresAt");

-- CreateIndex
CREATE INDEX "ItemListLine_listId_idx" ON "ItemListLine"("listId");

-- CreateIndex
CREATE INDEX "ListBroadcast_storeId_idx" ON "ListBroadcast"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ListBroadcast_listId_storeId_key" ON "ListBroadcast"("listId", "storeId");

-- CreateIndex
CREATE INDEX "StoreBid_storeId_idx" ON "StoreBid"("storeId");

-- CreateIndex
CREATE INDEX "StoreBid_status_idx" ON "StoreBid"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StoreBid_listId_storeId_key" ON "StoreBid"("listId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreBidLine_bidId_lineId_key" ON "StoreBidLine"("bidId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreReview_orderId_key" ON "StoreReview"("orderId");

-- CreateIndex
CREATE INDEX "StoreReview_storeId_idx" ON "StoreReview"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MobileRefreshToken_tokenHash_key" ON "MobileRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MobileRefreshToken_userId_idx" ON "MobileRefreshToken"("userId");

-- CreateIndex
CREATE INDEX "MobileRefreshToken_familyId_idx" ON "MobileRefreshToken"("familyId");

-- AddForeignKey
ALTER TABLE "ItemList" ADD CONSTRAINT "ItemList_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemList" ADD CONSTRAINT "ItemList_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemListLine" ADD CONSTRAINT "ItemListLine_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ItemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemListLine" ADD CONSTRAINT "ItemListLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemListLine" ADD CONSTRAINT "ItemListLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListBroadcast" ADD CONSTRAINT "ListBroadcast_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ItemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListBroadcast" ADD CONSTRAINT "ListBroadcast_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBid" ADD CONSTRAINT "StoreBid_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ItemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBid" ADD CONSTRAINT "StoreBid_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBidLine" ADD CONSTRAINT "StoreBidLine_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "StoreBid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreBidLine" ADD CONSTRAINT "StoreBidLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ItemListLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReview" ADD CONSTRAINT "StoreReview_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReview" ADD CONSTRAINT "StoreReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReview" ADD CONSTRAINT "StoreReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileRefreshToken" ADD CONSTRAINT "MobileRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

