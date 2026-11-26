/**
 * NEW-01 "the rider keeps the delivery fee": a cart order with an accepted rider bid
 * must not pay the rider twice. On full cash on delivery the rider collects the fee
 * in cash, so the platform owes them nothing for it (Delivery.riderFee = 0 at delivery).
 */
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/service")>()),
  notifyOrderEvent: vi.fn(async () => undefined),
}));

import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { createCheckoutOrder } from "@/lib/orders/checkout";
import { recordRiderFeeForOrder } from "@/lib/riders/pay";

describeDb("cart checkout with an accepted rider bid", () => {
  let f: Fixtures;

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { fullCodMaxOrderAmount: 10000 } });
    const grocery = (await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } })).id;
    const atta = await prisma.product.create({
      data: {
        storeId: f.S1.id, categoryId: grocery, name: "Atta 10kg", slug: "atta-10kg", sku: "ATTA",
        price: 1850, unit: "bag", status: "ACTIVE", stockQuantity: 50,
      },
    });
    await prisma.cart.create({
      data: { userId: f.customerA.id, items: { create: { productId: atta.id, quantity: 1 } } },
    });
    // The customer accepted rider R1's bid of Rs 150 a moment ago (pre-checkout auction).
    await prisma.deliveryRequest.create({
      data: {
        customerId: f.customerA.id,
        status: "ASSIGNED",
        expiresAt: new Date(Date.now() + 5 * 60_000),
        acceptedRiderId: f.R1.id,
        acceptedFee: 150,
        summary: { storeCount: 1, itemCount: 1, distanceKm: 50 },
      },
    });
  });

  it("full cash on delivery: the bid fee is the delivery fee, but the rider is not paid it again", async () => {
    const res = await createCheckoutOrder({
      userId: f.customerA.id,
      addressId: f.addressA.id,
      productPaymentChoice: "FULL_COD",
      idempotencyKey: "full-cod-bid-1",
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.order.orderNumber },
      include: { delivery: true },
    });
    expect(Number(order.deliveryFee)).toBe(150);
    expect(order.riderId).toBe(f.R1.id);
    expect(order.deliveryFeePaymentStatus).toBe("CASH_ON_DELIVERY");
    // Not fixed at checkout any more…
    expect(order.delivery?.riderId).toBe(f.R1.id);
    expect(order.delivery?.riderFee).toBeNull();

    // …and at delivery the platform owes only the online part of the fee: Rs 0.
    await prisma.order.update({ where: { id: order.id }, data: { orderStatus: "DELIVERED", deliveredAt: new Date() } });
    const fee = await prisma.$transaction((tx) => recordRiderFeeForOrder(tx, order.id));
    expect(fee).toBe(0);
  });
});
