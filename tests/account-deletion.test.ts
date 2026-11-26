/** W11: self-service account deletion (M1-12, P-04) and the app config endpoint (M1-08, P-06). */
import { beforeEach, expect, it, vi } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { requestAccountDeletion } from "@/lib/account/deletion";
import { issueRefreshToken, rotateRefreshToken } from "@/lib/auth/mobile-tokens";
import { registerDevice } from "@/lib/notifications/push";

describeDb("account deletion", () => {
  let f: Fixtures;

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });

  async function order(customerId: string, status: "CONFIRMED" | "DELIVERED", riderId?: string) {
    return prisma.order.create({
      data: {
        orderNumber: `T-${Math.random().toString(36).slice(2, 9)}`,
        customerId,
        subtotal: 100,
        deliveryFee: 50,
        grandTotal: 150,
        remainingAmount: 0,
        paymentMethod: "CASH_ON_DELIVERY",
        orderStatus: status,
        deliveryAddressSnapshot: {},
        riderId,
      },
    });
  }

  it("M1-12 a customer closes their account: can't sign in, app sessions and phones removed, open lists cancelled", async () => {
    const refresh = await issueRefreshToken(f.customerA.id);
    await registerDevice(f.customerA.id, "fcm-".padEnd(40, "a"));
    await order(f.customerA.id, "DELIVERED");
    const list = await prisma.itemList.create({
      data: { customerId: f.customerA.id, addressSnapshot: {}, city: "Lahore", expiresAt: new Date(Date.now() + 1e7) },
    });
    await prisma.storeBid.create({ data: { listId: list.id, storeId: f.S1.id, itemsTotal: 1, coveredCount: 1, listVersion: 1 } });

    expect(await requestAccountDeletion(f.customerA.id)).toEqual({ closed: true });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.customerA.id } })).isActive).toBe(false);
    expect((await rotateRefreshToken(refresh.token)).ok).toBe(false);
    expect(await prisma.deviceToken.count({ where: { userId: f.customerA.id } })).toBe(0);
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: list.id } })).status).toBe("CANCELLED");
    expect((await prisma.storeBid.findFirstOrThrow({ where: { listId: list.id } })).status).toBe("NOT_SELECTED");
    expect(await prisma.order.count({ where: { customerId: f.customerA.id } })).toBe(1); // records kept
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_DELETION_REQUESTED", userId: f.customerA.id } })).toBe(1);
    await expect(requestAccountDeletion(f.customerA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocked while the customer has an active order", async () => {
    await order(f.customerA.id, "CONFIRMED");
    await expect(requestAccountDeletion(f.customerA.id)).rejects.toMatchObject({ code: "ACTIVE_ORDERS", status: 409 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.customerA.id } })).isActive).toBe(true);
  });

  it("a rider with an active delivery or unremitted cash is blocked; otherwise goes offline and inactive", async () => {
    const o = await order(f.customerB.id, "DELIVERED", f.R1.id);
    await prisma.order.update({ where: { id: o.id }, data: { orderStatus: "OUT_FOR_DELIVERY" } });
    await expect(requestAccountDeletion(f.R1.userId!)).rejects.toMatchObject({ code: "ACTIVE_DELIVERIES" });
    await prisma.order.update({ where: { id: o.id }, data: { orderStatus: "DELIVERED" } });
    await prisma.cashRemittance.create({ data: { orderId: o.id, riderId: f.R1.id, amount: 150, status: "PENDING" } });
    await expect(requestAccountDeletion(f.R1.userId!)).rejects.toMatchObject({ code: "COD_OPEN" });
    await expect(requestAccountDeletion(f.R2.userId!)).resolves.toEqual({ closed: true });
    const r2 = await prisma.rider.findUniqueOrThrow({ where: { id: f.R2.id } });
    expect([r2.isActive, r2.status]).toEqual([false, "OFFLINE"]);
  });

  it("store owners and staff must go through support/admin", async () => {
    await expect(requestAccountDeletion(f.S1.ownerId)).rejects.toMatchObject({ code: "STORE_ACCOUNT" });
    await expect(requestAccountDeletion(f.admin.id)).rejects.toMatchObject({ code: "STAFF_ACCOUNT", status: 403 });
  });
});

describeDb("app config", () => {
  beforeEach(async () => {
    await resetDb();
    await seedStandardFixtures();
  });

  it("M1-08 / P-06 returns the version gate, feature switch and payment methods", async () => {
    vi.stubEnv("APP_MIN_VERSION", "1.2.0");
    const { GET } = await import("@/app/api/app/config/route");
    const body = await (await GET()).json();
    expect(body.data).toMatchObject({
      minAppVersion: "1.2.0",
      features: { listBidding: false },
      payments: { cashOnDelivery: true },
      links: { deleteAccount: "/delete-account" },
    });
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    expect((await (await GET()).json()).data.features.listBidding).toBe(true);
    vi.unstubAllEnvs();
  });
});
