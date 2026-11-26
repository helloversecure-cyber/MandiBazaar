/**
 * W10: push notifications to the Android app (J-01, J-04, J-05, O-04).
 * Firebase Cloud Messaging is replaced with a fake sender.
 */
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { pushToUser, registerDevice, removeDevice, setPushSender, type PushMessage } from "@/lib/notifications/push";
import { sendNotification } from "@/lib/notifications/service";
import { issueRefreshToken } from "@/lib/auth/mobile-tokens";
import { POST as logout } from "@/app/api/mobile/auth/logout/route";

const TOKEN = (n: number) => `fcm-token-${n}-`.padEnd(40, "x");

describeDb("push notifications", () => {
  let f: Fixtures;
  let sent: { tokens: string[]; msg: PushMessage }[];
  let failCodes: Record<string, string>;

  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });
  beforeEach(async () => {
    await prisma.deviceToken.deleteMany();
    sent = [];
    failCodes = {};
    setPushSender(async (tokens, msg) => {
      sent.push({ tokens, msg });
      return tokens.map((t) => (failCodes[t] ? { token: t, ok: false, code: failCodes[t] } : { token: t, ok: true }));
    });
  });
  afterEach(() => setPushSender(null));

  it("J-01 registering the same token twice keeps one row; a token moves to whoever signs in", async () => {
    await registerDevice(f.customerA.id, TOKEN(1));
    await registerDevice(f.customerA.id, TOKEN(1));
    expect(await prisma.deviceToken.count()).toBe(1);
    await registerDevice(f.customerB.id, TOKEN(1));
    const row = await prisma.deviceToken.findUniqueOrThrow({ where: { token: TOKEN(1) } });
    expect(row.userId).toBe(f.customerB.id);
  });

  it("an in-app notification is also pushed to every phone of that user, with deep-link data", async () => {
    await registerDevice(f.S1.ownerId, TOKEN(1));
    await registerDevice(f.S1.ownerId, TOKEN(2));
    const n = await sendNotification({
      userId: f.S1.ownerId,
      type: "NEW_LIST",
      title: "New list near you",
      body: "A customer 2 km away needs 3 items.",
      metadata: { listId: "list123" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].tokens.sort()).toEqual([TOKEN(1), TOKEN(2)]);
    expect(sent[0].msg).toMatchObject({
      title: "New list near you",
      data: { type: "NEW_LIST", listId: "list123", notificationId: n.id },
    });
  });

  it("no phones registered: nothing is pushed and the in-app notification is still saved", async () => {
    const n = await sendNotification({ userId: f.customerB.id, type: "X", title: "t", body: "b" });
    expect(sent).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("SENT");
  });

  it("secret messages never show their text on a lock screen", async () => {
    await registerDevice(f.customerA.id, TOKEN(3));
    await sendNotification({ userId: f.customerA.id, type: "RESET", title: "Reset code", body: "Your code is 123456", sensitive: true });
    expect(sent[0].msg.body).toBe("Open MandiBazaar to view this message.");
  });

  it("J-04 tokens FCM reports as dead are deleted, others kept", async () => {
    await registerDevice(f.customerA.id, TOKEN(4));
    await registerDevice(f.customerA.id, TOKEN(5));
    failCodes[TOKEN(4)] = "messaging/registration-token-not-registered";
    failCodes[TOKEN(5)] = "messaging/internal-error"; // temporary: keep
    const r = await pushToUser(f.customerA.id, { title: "t", body: "b" });
    expect(r).toEqual({ sent: 0, removed: 1 });
    expect((await prisma.deviceToken.findMany()).map((d) => d.token)).toEqual([TOKEN(5)]);
  });

  it("O-04 if FCM itself is down, the notification is still saved and nothing throws", async () => {
    await registerDevice(f.customerA.id, TOKEN(6));
    setPushSender(async () => {
      throw new Error("FCM unavailable");
    });
    const n = await sendNotification({ userId: f.customerA.id, type: "X", title: "t", body: "b" });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("SENT");
  });

  it("removeDevice only removes the caller's own token", async () => {
    await registerDevice(f.customerA.id, TOKEN(7));
    await removeDevice(TOKEN(7), f.customerB.id);
    expect(await prisma.deviceToken.count()).toBe(1);
    await removeDevice(TOKEN(7), f.customerA.id);
    expect(await prisma.deviceToken.count()).toBe(0);
  });

  it("J-05 app logout removes that phone's token, but only with the owner's valid refresh token", async () => {
    await registerDevice(f.customerA.id, TOKEN(8));
    const call = (body: unknown) =>
      logout(new Request("http://x/api/mobile/auth/logout", { method: "POST", body: JSON.stringify(body) }));
    // Someone else's (or no) refresh token can't remove it
    const other = await issueRefreshToken(f.customerB.id);
    await call({ refreshToken: other.token, deviceToken: TOKEN(8) });
    await call({ deviceToken: TOKEN(8) });
    expect(await prisma.deviceToken.count({ where: { token: TOKEN(8) } })).toBe(1);
    // The owner's sign-out removes it
    const mine = await issueRefreshToken(f.customerA.id);
    await call({ refreshToken: mine.token, deviceToken: TOKEN(8) });
    expect(await prisma.deviceToken.count({ where: { token: TOKEN(8) } })).toBe(0);
  });
});
