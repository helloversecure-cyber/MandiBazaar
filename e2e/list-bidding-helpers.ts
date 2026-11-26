/**
 * HTTP helpers for the W12 browser tests: stores bid on Customer A's list and
 * riders bid on the packed list order, through the real APIs with app tokens.
 */
import { execFileSync } from "node:child_process";
import { expect, type APIRequestContext } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";

const tokens: Record<string, string> = {};

export function bearer(email: string) {
  tokens[email] ??= execFileSync("npx", ["tsx", "e2e/mint-token.ts", email], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
  return { authorization: `Bearer ${tokens[email]}` };
}

/** NextAuth session cookie value for a seeded user (website sign-in). */
export function sessionCookie(email: string) {
  return execFileSync("npx", ["tsx", "e2e/mint-token.ts", email, "--cookie"], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
}

export function seedRiders(...keys: string[]) {
  execFileSync("npx", ["tsx", "e2e/seed-list-riders.ts", ...keys], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: "inherit",
  });
}

/** A store bids: one price per list line (null = "don't have"). */
export async function storeBid(
  request: APIRequestContext,
  ownerEmail: string,
  listId: string,
  prices: (number | null)[],
  extra: { prepMinutes?: number; discount?: number; note?: string } = {}
) {
  const S = bearer(ownerEmail);
  const view = await request.get(`/api/store/lists/${listId}`, { headers: S });
  expect(view.ok(), `${ownerEmail} sees the list: ${await view.text()}`).toBeTruthy();
  const lines = ((await view.json()).data.lines as { id: string }[]).map((l, i) =>
    prices[i] == null ? { lineId: l.id, available: false } : { lineId: l.id, available: true, unitPrice: prices[i] }
  );
  const res = await request.put(`/api/store/lists/${listId}/bid`, { headers: S, data: { lines, ...extra } });
  expect(res.ok(), `${ownerEmail} bids: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data;
}

/** The store marks its part of the order ready → rider bidding opens (W8). */
export async function markReady(request: APIRequestContext, ownerEmail: string, orderNumber: string) {
  const S = bearer(ownerEmail);
  const list = await request.get(`/api/store?resource=orders&q=${encodeURIComponent(orderNumber)}`, { headers: S });
  expect(list.ok(), `store orders: ${await list.text()}`).toBeTruthy();
  const items = (await list.json()).data.items as { id: string; status?: string }[];
  expect(items.length, "the store sees the order").toBeGreaterThan(0);
  const res = await request.patch("/api/store", {
    headers: S,
    data: { action: "FULFILLMENT_STATUS", fulfillmentId: items[0].id, status: "READY_FOR_DISPATCH" },
  });
  expect(res.ok(), `mark ready: ${await res.text()}`).toBeTruthy();
}

/** A rider bids a delivery fee on the order's after-packing request. */
export async function riderBid(request: APIRequestContext, riderEmail: string, requestId: string, amount: number) {
  const R = bearer(riderEmail);
  const res = await request.post("/api/rider/bids", { headers: R, data: { requestId, amount } });
  expect(res.ok(), `${riderEmail} bids: ${await res.text()}`).toBeTruthy();
}

/** The open request id on a list order (as Customer A sees it). */
export async function riderRequestId(request: APIRequestContext, orderNumber: string) {
  const A = bearer("customer.a@test.local");
  const res = await request.get(`/api/orders/${orderNumber}/rider-bids`, { headers: A });
  expect(res.ok(), `rider bids view: ${await res.text()}`).toBeTruthy();
  const id = (await res.json()).data.request?.id as string | undefined;
  expect(id, "after-packing request opened").toBeTruthy();
  return id!;
}

/** Customer A's default address id. */
export async function addressIdA(request: APIRequestContext) {
  const A = bearer("customer.a@test.local");
  const d = (await (await request.get("/api/addresses", { headers: A })).json()).data;
  return (Array.isArray(d) ? d : d.items)[0].id as string;
}
