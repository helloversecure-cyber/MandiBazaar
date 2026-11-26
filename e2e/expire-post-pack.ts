/**
 * Ends the after-packing rider bidding window of a list order right away, as
 * if it had passed twice with no bid (so the next tick moves it to NO_BIDS and
 * it lands in Admin → Needs rider). Browser tests only.
 *
 *   TEST_DATABASE_URL=... npx tsx e2e/expire-post-pack.ts <orderNumber>
 */
import "../tests/setup";
import { prisma } from "../tests/helpers/db";
import { POST_PACK_MAX_REOPENS } from "../src/lib/orders/post-pack-bidding";

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) throw new Error("usage: expire-post-pack.ts <orderNumber>");
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, select: { id: true } });
  const r = await prisma.deliveryRequest.updateMany({
    where: { orderId: order.id, trigger: "POST_PACK", status: "OPEN" },
    data: { expiresAt: new Date(Date.now() - 1000), reopenCount: POST_PACK_MAX_REOPENS },
  });
  if (r.count !== 1) throw new Error(`no open after-packing request on ${orderNumber}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
