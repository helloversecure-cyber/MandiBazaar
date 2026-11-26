/**
 * W13–W15 website portals: the store bid form helpers, rider fee checks, and
 * the admin item-list APIs (settings switch, lists overview and detail, the
 * "Needs rider" queue, bidding history on the admin order page).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string | null; role: string } },
}));
vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/auth")>();
  const need = async () => {
    if (!auth.session) throw new Error("UNAUTHORIZED");
    return auth.session;
  };
  const admin = async (permission?: string) => {
    const session = await need();
    const { hasPermission } = await import("@/lib/auth/permissions");
    if (session.user.role === "SUPER_ADMIN") return session;
    if (!["ADMIN", "ORDER_MANAGER", "INVENTORY_MANAGER", "DELIVERY_MANAGER"].includes(session.user.role)) throw new Error("FORBIDDEN");
    if (!permission || !hasPermission(session.user.role as never, permission as never)) throw new Error("FORBIDDEN");
    return session;
  };
  return { ...real, getSession: async () => auth.session, requireAuth: need, requireStorePortal: need, requireAdmin: admin };
});

import {
  applyServerBidError,
  bidDraftFor,
  bidTotals,
  postPackStateLabel,
  riderBidErrorMessage,
  storeBidErrorMessage,
  storeListState,
  storeListsNeedingAction,
  storeRiderStage,
  validateBidDraft,
  validateRiderFee,
  type StoreListDetail,
  type StoreListRow,
} from "@/lib/lists/store-ui";

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

const LIST: StoreListDetail = {
  listId: "L1",
  storeId: "S1",
  status: "BIDDING",
  version: 2,
  area: "Model Town",
  city: "Lahore",
  distanceKm: 2,
  note: null,
  expiresAt: future,
  declined: false,
  lines: [
    { id: "a", name: "Ghee", quantity: 1.5, unit: "kg", category: null, note: null },
    { id: "b", name: "Eggs", quantity: 2, unit: "dozen", category: null, note: null },
  ],
  myBid: null,
};

describe("store bid form (W13)", () => {
  it("state of a list for the store", () => {
    const base = { status: "BIDDING", expiresAt: future, declined: false, myBid: null };
    expect(storeListState(base).key).toBe("NEW");
    expect(storeListState({ ...base, declined: true }).key).toBe("DECLINED");
    expect(storeListState({ ...base, myBid: { status: "PENDING", needsUpdate: false } }).key).toBe("OFFER_SENT");
    expect(storeListState({ ...base, myBid: { status: "PENDING", needsUpdate: true } }).key).toBe("UPDATE_NEEDED");
    expect(storeListState({ ...base, myBid: { status: "WITHDRAWN", needsUpdate: false } }).key).toBe("WITHDRAWN");
    expect(storeListState({ ...base, expiresAt: past }).key).toBe("CLOSED");
    expect(storeListState({ ...base, status: "CANCELLED" }).help).toMatch(/cancelled/);
    const won = storeListState({ ...base, status: "ACCEPTED", myBid: { status: "ACCEPTED", needsUpdate: false, orderNumber: "MB-1" } });
    expect(won).toMatchObject({ key: "WON", tone: "success" });
    expect(won.help).toContain("MB-1");
    expect(storeListState({ ...base, status: "ACCEPTED", myBid: { status: "NOT_SELECTED", needsUpdate: false } }).key).toBe("NOT_SELECTED");
  });

  it("nav badge counts lists waiting for an offer", () => {
    const row = (over: Partial<StoreListRow>): StoreListRow => ({
      listId: "x",
      storeId: "s",
      status: "BIDDING",
      area: null,
      city: "Lahore",
      distanceKm: 1,
      lineCount: 2,
      expiresAt: future,
      sentAt: future,
      seen: false,
      declined: false,
      myBid: null,
      ...over,
    });
    const pending = { id: "b", status: "PENDING" as const, itemsTotal: 1, discount: 0, total: 1, prepMinutes: null, note: null, coveredCount: 1, needsUpdate: false, updatedAt: future, lines: [] };
    expect(
      storeListsNeedingAction([
        row({}),
        row({ declined: true }),
        row({ myBid: pending }),
        row({ myBid: { ...pending, needsUpdate: true } }),
        row({ expiresAt: past }),
      ])
    ).toBe(2);
  });

  it("live totals: quantity × price, minus discount; 'don't have' lines don't count", () => {
    const d = bidDraftFor(LIST);
    expect(d.lines.map((l) => l.available)).toEqual([true, true]);
    d.lines[0].price = "1300";
    d.lines[1].price = "38"; // half-typed
    d.discount = "50";
    const t = bidTotals(LIST.lines, d);
    expect(t).toMatchObject({ itemsTotal: 2026, discount: 50, total: 1976, covered: 2 });
    d.lines[1].available = false;
    expect(bidTotals(LIST.lines, d)).toMatchObject({ itemsTotal: 1950, total: 1900, covered: 1 });
  });

  it("draft keeps the store's offer, and what it typed across a reload", () => {
    const withBid: StoreListDetail = {
      ...LIST,
      myBid: {
        id: "B",
        status: "PENDING",
        itemsTotal: 2000,
        discount: 25,
        total: 1975,
        prepMinutes: 30,
        note: "fresh",
        coveredCount: 1,
        needsUpdate: true,
        updatedAt: future,
        lines: [{ lineId: "a", available: true, unitPrice: 1200 }],
      },
    };
    const d = bidDraftFor(withBid);
    expect(d).toMatchObject({ discount: "25", prepMinutes: "30", note: "fresh" });
    expect(d.lines).toEqual([
      { lineId: "a", available: true, price: "1200" },
      { lineId: "b", available: true, price: "" }, // new line the customer added
    ]);
    const typed = { ...d, lines: [{ lineId: "a", available: false, price: "" }, { lineId: "gone", available: true, price: "9" }] };
    const again = bidDraftFor(withBid, typed);
    expect(again.lines[0]).toEqual({ lineId: "a", available: false, price: "" });
    expect(again.lines.map((l) => l.lineId)).toEqual(["a", "b"]);
  });

  it("validation matches the API, payload carries listVersion", () => {
    const d = bidDraftFor(LIST);
    let v = validateBidDraft(LIST, d);
    expect(v.payload).toBeNull();
    expect(Object.keys(v.errors.lines)).toEqual(["a", "b"]);
    d.lines[0].price = "0";
    d.lines[1].price = "2000000";
    v = validateBidDraft(LIST, d);
    expect(v.errors.lines.a).toMatch(/Enter a price/);
    expect(v.errors.lines.b).toMatch(/too high/);
    d.lines = d.lines.map((l) => ({ ...l, available: false }));
    expect(validateBidDraft(LIST, d).errors.form).toMatch(/Can't supply/);
    d.lines[0] = { lineId: "a", available: true, price: "1000" };
    d.discount = "1500";
    expect(validateBidDraft(LIST, d).errors.discount).toMatch(/less than the total/);
    d.discount = "-1";
    expect(validateBidDraft(LIST, d).errors.discount).toMatch(/negative/);
    d.discount = "100";
    d.prepMinutes = "2";
    expect(validateBidDraft(LIST, d).errors.prepMinutes).toMatch(/at least 5/);
    d.prepMinutes = "12.5";
    expect(validateBidDraft(LIST, d).errors.prepMinutes).toMatch(/whole/);
    d.prepMinutes = "45";
    d.note = "x".repeat(301);
    expect(validateBidDraft(LIST, d).errors.note).toBeTruthy();
    d.note = "  ok  ";
    v = validateBidDraft(LIST, d);
    expect(v.payload).toEqual({
      storeId: "S1",
      listVersion: 2,
      lines: [
        { lineId: "a", available: true, unitPrice: 1000 },
        { lineId: "b", available: false },
      ],
      discount: 100,
      prepMinutes: 45,
      note: "ok",
    });
  });

  it("server errors land on the right line or field", () => {
    expect(applyServerBidError(LIST.lines, "lines.1.unitPrice", "Too high").lines).toEqual({ b: "Too high" });
    expect(applyServerBidError(LIST.lines, "discount", "No").discount).toBe("No");
    expect(applyServerBidError(LIST.lines, "lines.9.unitPrice", "?").form).toBe("?");
    expect(applyServerBidError(LIST.lines, null, "Oops").form).toBe("Oops");
  });

  it("error codes → messages", () => {
    expect(storeBidErrorMessage({ status: 409, code: "LIST_CHANGED" })).toMatchObject({ reload: true });
    expect(storeBidErrorMessage({ status: 409, code: "LIST_CLOSED" }).message).toMatch(/closed/);
    expect(storeBidErrorMessage({ status: 403, code: "STORE_NOT_ACTIVE" }).reload).toBe(false);
    expect(storeBidErrorMessage(null).message).toMatch(/connection/);
    expect(storeBidErrorMessage({ status: 500 }).message).toMatch(/our side/);
  });

  it("store orders: rider stage of a list order", () => {
    expect(storeRiderStage({ isListOrder: false, orderStatus: "READY_FOR_DISPATCH" })).toBeNull();
    expect(
      storeRiderStage({ isListOrder: true, orderStatus: "READY_FOR_DISPATCH", postPackRequest: { status: "OPEN", expiresAt: future } })
    ).toMatchObject({ label: "Riders are bidding", expiresAt: future });
    expect(
      storeRiderStage({ isListOrder: true, orderStatus: "READY_FOR_DISPATCH", postPackRequest: { status: "OPEN", expiresAt: past } })?.label
    ).toMatch(/choosing/);
    expect(
      storeRiderStage({ isListOrder: true, orderStatus: "READY_FOR_DISPATCH", postPackRequest: { status: "NO_BIDS", expiresAt: past } })?.tone
    ).toBe("warning");
    expect(storeRiderStage({ isListOrder: true, orderStatus: "ASSIGNED_TO_RIDER", rider: { name: "R1" } })?.label).toBe("Rider assigned: R1");
    expect(storeRiderStage({ isListOrder: true, orderStatus: "CONFIRMED" })).toBeNull();
  });
});

describe("rider fee and messages (W14)", () => {
  it("fee 1 … 10,000, whole rupees", () => {
    expect(validateRiderFee("")).toMatchObject({ amount: null });
    expect(validateRiderFee("0").error).toBeTruthy();
    expect(validateRiderFee("-5").error).toBeTruthy();
    expect(validateRiderFee("10001").error).toMatch(/10,000/);
    expect(validateRiderFee("149.6")).toEqual({ amount: 150, error: null });
  });
  it("codes → messages", () => {
    expect(riderBidErrorMessage({ status: 403, code: "TOO_FAR" }).message).toMatch(/too far/);
    expect(riderBidErrorMessage({ status: 403, code: "INELIGIBLE", error: "You're offline." }).message).toBe("You're offline.");
    expect(riderBidErrorMessage({ status: 409, code: "CLOSED" }).reload).toBe(true);
    expect(postPackStateLabel({ status: "NO_BIDS" })).toEqual({ label: "Needs rider", tone: "danger" });
    expect(postPackStateLabel({ status: "OPEN", biddingOpen: true }).label).toBe("Riders bidding");
    expect(postPackStateLabel({ status: "OPEN", biddingOpen: false, pendingBids: 2 }).label).toBe("Waiting for customer");
  });
});

// ── Admin APIs (DB) ─────────────────────────────────────────────────────────

import { createList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { bidSchema, submitBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { tickPostPackRequest } from "@/lib/orders/post-pack-bidding";
import { PATCH as storePatch } from "@/app/api/store/route";
import { PATCH as ordersPatch } from "@/app/api/orders/route";
import { GET as orderGet } from "@/app/api/orders/[orderNumber]/route";
import { GET as adminListsGet } from "@/app/api/admin/lists/route";
import { GET as adminListGet } from "@/app/api/admin/lists/[id]/route";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/admin/lists/settings/route";
import { GET as configGet } from "@/app/api/app/config/route";
import { adminReviewCounts } from "@/lib/catalog/admin-products";

describeDb("admin item-list bidding (W15)", () => {
  let f: Fixtures;
  let n = 0;
  const key = () => `adm-key-${++n}-${Date.now()}`;
  const as = (userId: string, role: string, email?: string | null) => (auth.session = { user: { id: userId, role, email } });
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });

  async function openList(lines = [{ name: "Atta", quantity: 2, unit: "kg" }]) {
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    return createList(
      { id: f.customerA.id },
      createListSchema.parse({ addressId: f.addressA.id, lines: lines.map((l) => ({ ...l, categoryId: grocery.id })) })
    );
  }

  async function listOrder() {
    const l = await openList();
    const s2 = await submitBid({ id: f.S2.ownerId }, l.id, bidSchema.parse({ lines: [{ lineId: l.lines[0].id, available: true, unitPrice: 520 }] }));
    void s2;
    const bid = await submitBid({ id: f.S1.ownerId }, l.id, bidSchema.parse({ lines: [{ lineId: l.lines[0].id, available: true, unitPrice: 500 }] }));
    const order = await acceptOffer(
      { id: f.customerA.id, email: f.customerA.email },
      l.id,
      acceptOfferSchema.parse({ bidId: bid.id, addressId: f.addressA.id, idempotencyKey: key() })
    );
    return { list: l, order };
  }

  async function markReady(orderId: string) {
    const ful = await prisma.storeFulfillment.findFirstOrThrow({ where: { orderId } });
    as(f.S1.ownerId, "STORE_OWNER");
    const res = await storePatch(
      new Request("http://localhost/api/store", {
        method: "PATCH",
        body: JSON.stringify({ action: "FULFILLMENT_STATUS", fulfillmentId: ful.id, status: "READY_FOR_DISPATCH" }),
      })
    );
    expect(res.status).toBe(200);
    return prisma.deliveryRequest.findUniqueOrThrow({ where: { orderId } });
  }

  /** Window passes twice with no bid → NO_BIDS. */
  async function noBids(requestId: string) {
    const later = (mins: number) => new Date(Date.now() + mins * 60_000);
    expect(await tickPostPackRequest(requestId, later(10))).toBe("REOPENED");
    expect(await tickPostPackRequest(requestId, later(30))).toBe("GAVE_UP");
  }

  const VALID = {
    enabled: false,
    radiusStartKm: 3,
    radiusMaxKm: 20,
    radiusStepKm: 5,
    radiusStepMins: 30,
    maxStores: 20,
    expiryHours: 48,
    postPackBidWindowSecs: 300,
    postPackRiderRadiusKm: 10,
  };
  const putSettings = async (body: unknown) =>
    json(await settingsPut(new Request("http://localhost/api/admin/lists/settings", { method: "PUT", body: JSON.stringify(body) })));

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    vi.stubEnv("LIST_BIDDING_BETA_EMAILS", "Beta.One@test.local, beta.two@test.local");
  });
  afterEach(() => {
    auth.session = null;
    vi.unstubAllEnvs();
  });

  it("I-04/I-05: settings — read, validate, switch off and on (audited), next list uses the new radius", async () => {
    auth.session = null;
    expect((await json(await settingsGet())).status).toBe(401);
    as(f.customerA.id, "CUSTOMER");
    expect((await json(await settingsGet())).status).toBe(403);
    as(f.admin.id, "ORDER_MANAGER");
    expect((await json(await settingsGet())).status).toBe(403);

    as(f.admin.id, "SUPER_ADMIN");
    const got = await json(await settingsGet());
    expect(got.body.data).toMatchObject({ enabled: true, radiusStartKm: 5, betaEmails: ["beta.one@test.local", "beta.two@test.local"] });

    const bad = await putSettings({ ...VALID, radiusStartKm: 0, radiusMaxKm: 2 });
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors.radiusStartKm).toMatch(/At least 1/);
    expect((await putSettings({ ...VALID, radiusStartKm: 10, radiusMaxKm: 5 })).body.fieldErrors.radiusMaxKm).toMatch(/starting radius/);
    expect((await putSettings({ ...VALID, postPackBidWindowSecs: 5 })).status).toBe(400);
    expect((await putSettings(null)).status).toBe(400);

    const off = await putSettings(VALID);
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ enabled: false, radiusStartKm: 3 });
    expect(off.body.data.changed.sort()).toEqual(["enabled", "radiusStartKm"]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "LIST_BIDDING_SWITCHED_OFF" } });
    expect(log).toMatchObject({ userId: f.admin.id, previousValue: { enabled: true, radiusStartKm: 5 }, newValue: { enabled: false, radiusStartKm: 3 } });

    // Off for the public: a non-beta customer's app config says so.
    as(f.customerB.id, "CUSTOMER", f.customerB.email);
    const cfg = await json(await configGet());
    expect(cfg.body.data.features.listBidding).toBe(false);

    as(f.admin.id, "SUPER_ADMIN");
    expect((await putSettings({ ...VALID, enabled: true })).body.data.enabled).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "LIST_BIDDING_SWITCHED_ON" } })).toBe(1);
    as(f.customerB.id, "CUSTOMER", f.customerB.email);
    expect((await json(await configGet())).body.data.features.listBidding).toBe(true);

    // I-04: the next list starts at 3 km.
    const l = await openList();
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: l.id } })).radiusKm).toBe(3);

    // Saving the same values writes no audit row.
    as(f.admin.id, "SUPER_ADMIN");
    const before = await prisma.auditLog.count({ where: { entity: "StoreSettings" } });
    expect((await putSettings({ ...VALID, enabled: true })).body.data.changed).toEqual([]);
    expect(await prisma.auditLog.count({ where: { entity: "StoreSettings" } })).toBe(before);
  });

  it("I-01: lists overview and one list's history", async () => {
    const { list, order } = await listOrder();
    const open = await openList([{ name: "Milk", quantity: 1, unit: "L" }]);
    as(f.admin.id, "ORDER_MANAGER");
    const all = await json(await adminListsGet(new Request("http://localhost/api/admin/lists")));
    expect(all.status).toBe(200);
    expect(all.body.data.counts).toMatchObject({ ACCEPTED: 1, BIDDING: 1 });
    const row = all.body.data.items.find((r: { id: string }) => r.id === list.id);
    expect(row).toMatchObject({
      status: "ACCEPTED",
      customerName: "Customer A",
      offersCount: 2,
      acceptedStore: "TEST S1",
      acceptedTotal: 1000,
      order: { orderNumber: order.orderNumber },
    });
    expect(row.storesSent).toBeGreaterThanOrEqual(2);
    const bidding = await json(await adminListsGet(new Request("http://localhost/api/admin/lists?status=bidding")));
    expect(bidding.body.data.items.map((r: { id: string }) => r.id)).toEqual([open.id]);
    const byOrder = await json(await adminListsGet(new Request(`http://localhost/api/admin/lists?q=${order.orderNumber}`)));
    expect(byOrder.body.data.items.map((r: { id: string }) => r.id)).toEqual([list.id]);

    const d = await json(await adminListGet(new Request("http://localhost"), { params: { id: list.id } }));
    expect(d.status).toBe(200);
    expect(d.body.data.order.orderNumber).toBe(order.orderNumber);
    expect(d.body.data.broadcasts.length).toBeGreaterThanOrEqual(2);
    expect(d.body.data.bids.map((b: { storeName: string; status: string; accepted: boolean }) => [b.storeName, b.status, b.accepted])).toEqual([
      ["TEST S2", "NOT_SELECTED", false],
      ["TEST S1", "ACCEPTED", true],
    ]);
    expect(d.body.data.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(["LIST_CREATED", "STORE_BID_SUBMITTED", "LIST_OFFER_ACCEPTED"])
    );
    expect((await json(await adminListGet(new Request("http://localhost"), { params: { id: "nope" } }))).status).toBe(404);

    as(f.S1.ownerId, "STORE_OWNER");
    expect((await json(await adminListsGet(new Request("http://localhost/api/admin/lists")))).status).toBe(403);
  });

  it("G-14/G-15/I-02: NO_BIDS goes to Needs rider, admin assigns, order page shows the history", async () => {
    const { order } = await listOrder();
    const req = await markReady(order.orderId);
    as(f.admin.id, "SUPER_ADMIN");
    let q = await json(await adminListsGet(new Request("http://localhost/api/admin/lists?view=needs-rider")));
    expect(q.body.data.needsRider).toEqual([]);
    expect(q.body.data.bidding.map((i: { requestId: string }) => i.requestId)).toEqual([req.id]);

    await noBids(req.id);
    expect((await adminReviewCounts()).needsRider).toBe(1);
    q = await json(await adminListsGet(new Request("http://localhost/api/admin/lists?view=needs-rider")));
    expect(q.body.data.needsRider).toHaveLength(1);
    expect(q.body.data.needsRider[0]).toMatchObject({
      status: "NO_BIDS",
      reopenCount: 1,
      storeName: "TEST S1",
      order: { orderNumber: order.orderNumber, customerName: "Customer A" },
    });

    // Admin assigns R1 with the existing ASSIGN_RIDER action.
    const res = await json(
      await ordersPatch(
        new NextRequest("http://localhost/api/orders", {
          method: "PATCH",
          body: JSON.stringify({ orderId: order.orderId, action: "ASSIGN_RIDER", riderId: f.R1.id }),
        })
      )
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    q = await json(await adminListsGet(new Request("http://localhost/api/admin/lists?view=needs-rider")));
    expect(q.body.data.needsRider).toEqual([]);
    expect((await adminReviewCounts()).needsRider).toBe(0);

    const detail = await json(await orderGet(new NextRequest("http://localhost"), { params: { orderNumber: order.orderNumber } }));
    expect(detail.status).toBe(200);
    const b = detail.body.data.admin.bidding;
    expect(b.list).toMatchObject({ storesSent: expect.any(Number) });
    expect(b.list.offers.find((o: { accepted: boolean }) => o.accepted)).toMatchObject({ storeName: "TEST S1", total: 1000 });
    expect(b.list.acceptedAt).toBeTruthy();
    expect(b.riderBidding).toMatchObject({ trigger: "POST_PACK", status: "NO_BIDS", reopenCount: 1, bids: [] });
    expect(detail.body.data.admin.deliveryCodeRequired).toBe(true);
  });

  it("cart orders have no bidding history on the admin order page", async () => {
    as(f.admin.id, "SUPER_ADMIN");
    const o = await prisma.order.create({
      data: {
        orderNumber: "MB-CART-1",
        customerId: f.customerA.id,
        subtotal: 100,
        deliveryFee: 0,
        grandTotal: 100,
        remainingAmount: 100,
        paymentMethod: "CASH_ON_DELIVERY",
        deliveryAddressSnapshot: {},
      },
    });
    const detail = await json(await orderGet(new NextRequest("http://localhost"), { params: { orderNumber: o.orderNumber } }));
    expect(detail.status).toBe(200);
    expect(detail.body.data.admin.bidding).toBeNull();
  });
});
