import Stripe from "stripe";
import { addPayment, toLedgerOrder } from "@/lib/orders/payment-ledger";
import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncOrderAfterFulfillmentReady } from "@/lib/orders/fulfillment-sync";
import { STRIPE_MIN_AMOUNT_PKR } from "@/lib/payments/card-minimum";
import { recordCustomerPaymentLedger, recordOrderConfirmedLedger } from "@/lib/finance/ledger";

export type StripeMode = "test" | "live";

/**
 * Keys live in .env:
 *   STRIPE_MODE=test|live
 *   STRIPE_SECRET_KEY_TEST=sk_test_...
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_...
 *   STRIPE_WEBHOOK_SECRET_TEST=whsec_...
 *   STRIPE_SECRET_KEY_LIVE=sk_live_...
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE=pk_live_...
 *   STRIPE_WEBHOOK_SECRET_LIVE=whsec_...
 *
 * Fallback (single key): STRIPE_SECRET_KEY + NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 */
export function getStripeMode(): StripeMode {
  const mode = (process.env.STRIPE_MODE || "test").toLowerCase();
  return mode === "live" ? "live" : "test";
}

export function getStripeSecretKey(): string {
  const mode = getStripeMode();
  if (mode === "live") {
    return (
      process.env.STRIPE_SECRET_KEY_LIVE ||
      process.env.STRIPE_SECRET_KEY ||
      ""
    );
  }
  return (
    process.env.STRIPE_SECRET_KEY_TEST ||
    process.env.STRIPE_SECRET_KEY ||
    ""
  );
}

export function getStripePublishableKey(): string {
  const mode = getStripeMode();
  if (mode === "live") {
    return (
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE ||
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      ""
    );
  }
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ""
  );
}

export function getStripeWebhookSecret(): string {
  const mode = getStripeMode();
  if (mode === "live") {
    return (
      process.env.STRIPE_WEBHOOK_SECRET_LIVE ||
      process.env.STRIPE_WEBHOOK_SECRET ||
      ""
    );
  }
  return (
    process.env.STRIPE_WEBHOOK_SECRET_TEST ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    ""
  );
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey() && getStripePublishableKey());
}

let stripeClient: Stripe | null = null;
let stripeClientKey = "";

export function getStripe(): Stripe {
  const key = getStripeSecretKey();
  if (!key) throw new Error("Stripe is not configured");
  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key, {
      apiVersion: "2026-08-26.dahlia",
      typescript: true,
    });
    stripeClientKey = key;
  }
  return stripeClient;
}

export type CreateStripeCheckoutInput = {
  orderId: string;
  orderNumber: string;
  amountPkr: number;
  paymentType: "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT";
  customerEmail?: string | null;
  customerPhone?: string | null;
  idempotencyKey: string;
};

/**
 * Stripe amounts are in the smallest currency unit.
 * PKR uses 2 decimals → send paisa (rupees × 100).
 * Example: Rs. 304 → 30400
 */
export function toStripeAmount(pkr: number) {
  return Math.max(1, Math.round(Number(pkr) * 100));
}

/** Stripe rejects charges that convert to < ~$0.50 / €0.50 (see card-minimum.ts). */
export { STRIPE_MIN_AMOUNT_PKR };

export function assertStripeMinAmount(pkr: number) {
  if (pkr > 0 && pkr < STRIPE_MIN_AMOUNT_PKR) {
    throw new Error(
      `Card needs at least Rs ${STRIPE_MIN_AMOUNT_PKR}. This payment is Rs ${Math.round(pkr)} — please pay with JazzCash instead.`
    );
  }
}

export async function createStripeCheckoutSession(
  input: CreateStripeCheckoutInput
) {
  const stripe = getStripe();
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  const amount = toStripeAmount(input.amountPkr);
  assertStripeMinAmount(input.amountPkr);
  const label =
    input.paymentType === "FULL_PAYMENT"
      ? `Order ${input.orderNumber} (delivery + products)`
      : input.paymentType === "DELIVERY_FEE"
        ? `Order ${input.orderNumber} delivery fee`
        : `Order ${input.orderNumber} products`;

  const payment = await prisma.payment.create({
    data: {
      orderId: input.orderId,
      type: input.paymentType,
      method: "STRIPE",
      amount: input.amountPkr,
      status: "INITIATED",
      reference: `pending_${input.orderNumber}_${Date.now()}`,
      metadata: {
        provider: "stripe",
        mode: getStripeMode(),
        paymentType: input.paymentType,
      },
    },
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "pkr",
            unit_amount: amount,
            product_data: {
              name: label,
              description: `MandiBazaar ${input.orderNumber}`,
            },
          },
        },
      ],
      success_url: `${base}/checkout/confirmation?order=${encodeURIComponent(input.orderNumber)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout/payment?error=${encodeURIComponent("Payment cancelled")}&order=${encodeURIComponent(input.orderNumber)}&orderId=${encodeURIComponent(input.orderId)}`,
      customer_email: input.customerEmail || undefined,
      client_reference_id: input.orderId,
      metadata: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        paymentId: payment.id,
        paymentType: input.paymentType,
        amountPkr: String(input.amountPkr),
      },
    },
    { idempotencyKey: input.idempotencyKey.slice(0, 255) }
  );

  const txnRefNo = session.id;
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      reference: txnRefNo,
      providerTxnId: session.payment_intent
        ? String(session.payment_intent)
        : null,
      metadata: {
        provider: "stripe",
        mode: getStripeMode(),
        paymentType: input.paymentType,
        checkoutSessionId: session.id,
      },
    },
  });

  await prisma.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      orderId: input.orderId,
      txnRefNo,
      amount: input.amountPkr,
      status: "INITIATED",
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        sessionId: session.id,
        url: session.url,
        mode: getStripeMode(),
      },
    },
  });

  return {
    paymentId: payment.id,
    sessionId: session.id,
    url: session.url,
    publishableKey: getStripePublishableKey(),
    mode: getStripeMode(),
  };
}

/** In-app card form: PaymentIntent + Stripe Elements (no redirect away). */
export async function createStripePaymentIntent(
  input: CreateStripeCheckoutInput
) {
  const stripe = getStripe();
  const amount = toStripeAmount(input.amountPkr);
  assertStripeMinAmount(input.amountPkr);
  const label =
    input.paymentType === "FULL_PAYMENT"
      ? `Order ${input.orderNumber} (delivery + products)`
      : input.paymentType === "DELIVERY_FEE"
        ? `Order ${input.orderNumber} delivery fee`
        : `Order ${input.orderNumber} products`;

  const payment = await prisma.payment.create({
    data: {
      orderId: input.orderId,
      type: input.paymentType,
      method: "STRIPE",
      amount: input.amountPkr,
      status: "INITIATED",
      reference: `pending_${input.orderNumber}_${Date.now()}`,
      metadata: {
        provider: "stripe",
        mode: getStripeMode(),
        paymentType: input.paymentType,
        flow: "payment_element",
      },
    },
  });

  const intent = await stripe.paymentIntents.create(
    {
      amount,
      currency: "pkr",
      payment_method_types: ["card"],
      description: label,
      receipt_email: input.customerEmail || undefined,
      metadata: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        paymentId: payment.id,
        paymentType: input.paymentType,
        amountPkr: String(input.amountPkr),
      },
    },
    { idempotencyKey: input.idempotencyKey.slice(0, 255) }
  );

  if (!intent.client_secret) {
    throw new Error("Stripe did not return a client secret");
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      reference: intent.id,
      providerTxnId: intent.id,
      metadata: {
        provider: "stripe",
        mode: getStripeMode(),
        paymentType: input.paymentType,
        paymentIntentId: intent.id,
        flow: "payment_element",
      },
    },
  });

  await prisma.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      orderId: input.orderId,
      txnRefNo: intent.id,
      amount: input.amountPkr,
      status: "INITIATED",
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        paymentIntentId: intent.id,
        mode: getStripeMode(),
        flow: "payment_element",
      },
    },
  });

  return {
    paymentId: payment.id,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    publishableKey: getStripePublishableKey(),
    mode: getStripeMode(),
    amountPkr: input.amountPkr,
  };
}

const TERMINAL_ORDER: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
  OrderStatus.RETURNED,
  OrderStatus.DELIVERED,
];

export async function processStripeCheckoutCompleted(session: Stripe.Checkout.Session): Promise<{
  success: boolean;
  message: string;
  orderId?: string;
  alreadyProcessed?: boolean;
  needsRefundReview?: boolean;
  paymentId?: string;
  paidAmount?: number;
}> {
  const orderId = session.metadata?.orderId || session.client_reference_id;
  const paymentId = session.metadata?.paymentId;
  const paymentType = (session.metadata?.paymentType ||
    "FULL_PAYMENT") as "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT";

  if (!orderId) {
    return { success: false, message: "Missing orderId on Stripe session" };
  }

  const txn = await prisma.paymentTransaction.findFirst({
    where: {
      OR: [
        { txnRefNo: session.id },
        ...(paymentId ? [{ paymentId }] : []),
      ],
    },
    include: { payment: true },
    orderBy: { createdAt: "desc" },
  });

  if (txn?.status === "SUCCESS" && txn.verifiedAt) {
    return {
      success: true,
      message: "Already processed",
      orderId,
      alreadyProcessed: true,
    };
  }

  if (session.payment_status !== "paid") {
    return { success: false, message: "Session not paid", orderId };
  }

  const paymentIntentId = session.payment_intent
    ? String(
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent.id
      )
    : session.id;

  const resolvedType = (
    txn?.payment.type === "DELIVERY_FEE" ||
    txn?.payment.type === "PRODUCT_AMOUNT" ||
    txn?.payment.type === "FULL_PAYMENT"
      ? txn.payment.type
      : paymentType
  ) as "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT";

  return markStripeOrderPaid({
    orderId,
    paymentType: resolvedType,
    paidAmount: Number(
      session.metadata?.amountPkr || txn?.amount || 0
    ),
    txn,
    providerRef: session.id,
    paymentIntentId,
    responsePayload: {
      sessionId: session.id,
      paymentIntent: paymentIntentId,
      paymentStatus: session.payment_status,
    },
  });
}

export async function processStripePaymentIntentSucceeded(
  intent: Stripe.PaymentIntent
): Promise<{
  success: boolean;
  message: string;
  orderId?: string;
  alreadyProcessed?: boolean;
  needsRefundReview?: boolean;
  paymentId?: string;
  paidAmount?: number;
}> {
  const orderId = intent.metadata?.orderId;
  const paymentId = intent.metadata?.paymentId;
  const paymentType = (intent.metadata?.paymentType ||
    "FULL_PAYMENT") as "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT";

  if (!orderId) {
    return { success: false, message: "Missing orderId on PaymentIntent" };
  }

  if (intent.status !== "succeeded") {
    return { success: false, message: `Intent status is ${intent.status}`, orderId };
  }

  const txn = await prisma.paymentTransaction.findFirst({
    where: {
      OR: [
        { txnRefNo: intent.id },
        ...(paymentId ? [{ paymentId }] : []),
      ],
    },
    include: { payment: true },
    orderBy: { createdAt: "desc" },
  });

  if (txn?.status === "SUCCESS" && txn.verifiedAt) {
    return {
      success: true,
      message: "Already processed",
      orderId,
      alreadyProcessed: true,
    };
  }

  const resolvedType = (
    txn?.payment.type === "DELIVERY_FEE" ||
    txn?.payment.type === "PRODUCT_AMOUNT" ||
    txn?.payment.type === "FULL_PAYMENT"
      ? txn.payment.type
      : paymentType
  ) as "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT";

  return markStripeOrderPaid({
    orderId,
    paymentType: resolvedType,
    paidAmount: Number(intent.metadata?.amountPkr || txn?.amount || 0),
    txn,
    providerRef: intent.id,
    paymentIntentId: intent.id,
    responsePayload: {
      paymentIntent: intent.id,
      status: intent.status,
    },
  });
}

async function markStripeOrderPaid(opts: {
  orderId: string;
  paymentType: "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT";
  paidAmount: number;
  txn: {
    id: string;
    paymentId: string;
    amount: unknown;
  } | null;
  providerRef: string;
  paymentIntentId: string;
  responsePayload: Prisma.InputJsonValue;
}) {
  const { orderId, paymentType, txn, paymentIntentId, responsePayload } = opts;
  let paidAmount = opts.paidAmount;

  return prisma.$transaction(async (tx) => {
    // Idempotency (QA P2: payments recorded twice when confirm + webhook both fire):
    // only the first caller may move this transaction to SUCCESS.
    if (txn) {
      const claimed = await tx.paymentTransaction.updateMany({
        where: { id: txn.id, status: { not: "SUCCESS" } },
        data: {
          status: "SUCCESS",
          verifiedAt: new Date(),
          responsePayload,
        },
      });
      if (claimed.count === 0) {
        return { success: true, message: "Stripe payment already processed", orderId, alreadyProcessed: true };
      }
      await tx.payment.update({
        where: { id: txn.paymentId },
        data: {
          status: "SUCCESS",
          paidAt: new Date(),
          providerTxnId: paymentIntentId,
          metadata: {
            provider: "stripe",
            paymentIntent: paymentIntentId,
            providerRef: opts.providerRef,
          },
        },
      });
      if (!paidAmount) paidAmount = Number(txn.amount);
    }

    if (!txn) {
      const dup = await tx.payment.findFirst({
        where: { orderId, providerTxnId: paymentIntentId, status: "SUCCESS" },
        select: { id: true },
      });
      if (dup) {
        return { success: true, message: "Stripe payment already processed", orderId, alreadyProcessed: true };
      }
    }

    // Lock the order row so concurrent callbacks can't both add on top of the same value
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

    if (TERMINAL_ORDER.includes(order.orderStatus)) {
      if (txn) {
        const prev = await tx.payment.findUnique({ where: { id: txn.paymentId } });
        const meta =
          prev?.metadata &&
          typeof prev.metadata === "object" &&
          !Array.isArray(prev.metadata)
            ? { ...(prev.metadata as Record<string, unknown>) }
            : {};
        await tx.payment.update({
          where: { id: txn.paymentId },
          data: {
            metadata: {
              ...meta,
              provider: "stripe",
              paymentIntent: paymentIntentId,
              latePaymentOnTerminalOrder: true,
              orderStatusAtCallback: order.orderStatus,
            },
          },
        });
      }
      return {
        success: true,
        message:
          "Payment received but order already closed — admin must refund",
        orderId,
        needsRefundReview: true,
        paymentId: txn?.paymentId,
        paidAmount: paidAmount || (txn ? Number(txn.amount) : 0),
      };
    }

    if (!paidAmount) {
      paidAmount =
        paymentType === "DELIVERY_FEE"
          ? Number(order.deliveryFee)
          : paymentType === "PRODUCT_AMOUNT"
            ? Number(order.subtotal) - Number(order.discount)
            : Number(order.grandTotal);
    }

    // Cap every amount at what is actually due (never record more than the order bills)
    const ledger = addPayment(toLedgerOrder(order), paymentType, paidAmount);
    const nextStatus =
      order.orderStatus === "PENDING_PAYMENT" ? "CONFIRMED" : order.orderStatus;

    if (paymentType === "DELIVERY_FEE") {
      await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryFeePaid: ledger.deliveryFeePaid,
          deliveryFeePaymentStatus: ledger.feeFullyPaid ? "PAID" : order.deliveryFeePaymentStatus,
          orderStatus: nextStatus,
          paymentMethod:
            order.productPaymentStatus === "CASH_ON_DELIVERY"
              ? "MIXED"
              : "STRIPE",
        },
      });
    } else if (paymentType === "PRODUCT_AMOUNT") {
      await tx.order.update({
        where: { id: orderId },
        data: {
          productAmountPaid: ledger.productAmountPaid,
          remainingAmount: ledger.remainingAmount,
          productPaymentStatus: ledger.productFullyPaid ? "PAID" : "PARTIALLY_PAID",
          paymentMethod: "STRIPE",
          orderStatus: nextStatus,
        },
      });
    } else {
      await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryFeePaid: ledger.deliveryFeePaid,
          productAmountPaid: ledger.productAmountPaid,
          remainingAmount: ledger.remainingAmount,
          deliveryFeePaymentStatus: ledger.feeFullyPaid ? "PAID" : order.deliveryFeePaymentStatus,
          productPaymentStatus: ledger.productFullyPaid ? "PAID" : "PARTIALLY_PAID",
          paymentMethod: "STRIPE",
          orderStatus: nextStatus,
        },
      });
    }

    if (ledger.excess > 0) {
      await tx.auditLog.create({
        data: {
          action: "PAYMENT_OVER_RECORDED",
          entity: "Order",
          entityId: orderId,
          newValue: { provider: "stripe", paymentIntentId, excess: ledger.excess },
        },
      });
    }

    await tx.storeFulfillment.updateMany({
      where: { orderId, status: "PENDING_PAYMENT" },
      data: { status: "CONFIRMED" },
    });
    await syncOrderAfterFulfillmentReady(tx, orderId);

    // Append-only ledger: record the customer payment + snapshot sale/commission/
    // earnings on first confirmation (idempotent via the payment-intent ref).
    await recordCustomerPaymentLedger(tx, {
      orderId,
      amount: paidAmount,
      refId: `stripe_${paymentIntentId}`,
    });
    if (order.orderStatus === "PENDING_PAYMENT") {
      await recordOrderConfirmedLedger(tx, orderId);
    }

    return { success: true, message: "Stripe payment verified", orderId };
  });
}

export async function resumeStripePayment(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId },
    include: {
      customer: { select: { email: true, phone: true } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) throw new Error("Order not found");
  if (order.orderStatus !== "PENDING_PAYMENT") {
    throw new Error("Order does not require payment resume");
  }

  const productPending =
    order.productPaymentStatus === "PENDING" ||
    order.productPaymentStatus === "FAILED";
  const feePending = ["PENDING", "INITIATED", "FAILED"].includes(
    order.deliveryFeePaymentStatus
  );
  const productTotal = Number(order.subtotal) - Number(order.discount);

  let amount = 0;
  let paymentType: "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT" =
    "DELIVERY_FEE";

  if (feePending && productPending) {
    amount = Number(order.grandTotal);
    paymentType = "FULL_PAYMENT";
  } else if (feePending) {
    amount = Number(order.deliveryFee);
    paymentType = "DELIVERY_FEE";
  } else if (productPending) {
    amount = productTotal;
    paymentType = "PRODUCT_AMOUNT";
  } else {
    throw new Error("Nothing left to pay on this order");
  }

  if (amount <= 0) throw new Error("Nothing left to pay");

  const checkout = await createStripePaymentIntent({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountPkr: amount,
    paymentType,
    customerEmail: order.customer.email,
    customerPhone: order.customer.phone,
    idempotencyKey: `stripe-resume:${order.id}:${Date.now()}`,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: {
      deliveryFeePaymentStatus:
        paymentType === "DELIVERY_FEE" || paymentType === "FULL_PAYMENT"
          ? "INITIATED"
          : order.deliveryFeePaymentStatus,
    },
  });

  return { order, checkout };
}

/** Real Stripe money reverse when refund is completed */
export async function refundStripePayment(opts: {
  paymentIntentId: string;
  amountPkr: number;
  reason?: string;
  idempotencyKey?: string;
}) {
  const stripe = getStripe();
  return stripe.refunds.create(
    {
      payment_intent: opts.paymentIntentId,
      amount: toStripeAmount(opts.amountPkr),
      reason: "requested_by_customer",
      metadata: { note: opts.reason || "" },
    },
    opts.idempotencyKey
      ? { idempotencyKey: opts.idempotencyKey.slice(0, 255) }
      : undefined
  );
}
