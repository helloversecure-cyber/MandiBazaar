import crypto from "crypto";
import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  syncFulfillmentsToOrderStatus,
  syncOrderAfterFulfillmentReady,
} from "@/lib/orders/fulfillment-sync";
import { lockAndAddPayment } from "@/lib/orders/payment-ledger";
import { recordCustomerPaymentLedger, recordOrderConfirmedLedger } from "@/lib/finance/ledger";

export type JazzCashRequest = {
  amount: number; // PKR
  billReference: string;
  description: string;
  txnRefNo: string;
  returnUrl?: string;
};

function getConfig() {
  return {
    merchantId: process.env.JAZZCASH_MERCHANT_ID || "",
    password: process.env.JAZZCASH_PASSWORD || "",
    integritySalt: process.env.JAZZCASH_INTEGRITY_SALT || "",
    returnUrl:
      process.env.JAZZCASH_RETURN_URL ||
      `${process.env.NEXT_PUBLIC_APP_URL}/api/jazzcash/callback`,
    paymentUrl:
      process.env.JAZZCASH_PAYMENT_URL ||
      "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/",
    sandbox: process.env.JAZZCASH_SANDBOX !== "false",
  };
}

export function isJazzCashConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.merchantId && cfg.password && cfg.integritySalt);
}

/** JazzCash expects amount in paisa (x100) as integer string */
export function toPaisa(amountPkr: number): string {
  return String(Math.round(amountPkr * 100));
}

export function generateTxnRefNo(prefix = "T") {
  const now = new Date();
  const ts =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${ts}${rand}`.slice(0, 20);
}

/**
 * JazzCash secure hash: HMAC-SHA256 of sorted field values joined by '&'
 * Prefixed with integrity salt.
 */
export function generateSecureHash(
  fields: Record<string, string>,
  integritySalt: string
): string {
  const sortedKeys = Object.keys(fields)
    .filter((k) => k !== "pp_SecureHash" && fields[k] !== "" && fields[k] != null)
    .sort();
  const values = sortedKeys.map((k) => fields[k]);
  const stringToHash = `${integritySalt}&${values.join("&")}`;
  return crypto
    .createHmac("sha256", integritySalt)
    .update(stringToHash)
    .digest("hex")
    .toUpperCase();
}

export function verifySecureHash(
  fields: Record<string, string>,
  integritySalt: string
): boolean {
  const received = (fields.pp_SecureHash || "").toUpperCase();
  if (!received) return false;
  const expected = generateSecureHash(fields, integritySalt);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(received),
      Buffer.from(expected)
    );
  } catch {
    return received === expected;
  }
}

export function buildJazzCashPaymentForm(req: JazzCashRequest) {
  const cfg = getConfig();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateTime =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());

  const expiry = new Date(now.getTime() + 60 * 60 * 1000);
  const expiryDateTime =
    expiry.getFullYear().toString() +
    pad(expiry.getMonth() + 1) +
    pad(expiry.getDate()) +
    pad(expiry.getHours()) +
    pad(expiry.getMinutes()) +
    pad(expiry.getSeconds());

  const fields: Record<string, string> = {
    pp_Version: "1.1",
    pp_TxnType: "MPAY",
    pp_Language: "EN",
    pp_MerchantID: cfg.merchantId,
    pp_Password: cfg.password,
    pp_TxnRefNo: req.txnRefNo,
    pp_Amount: toPaisa(req.amount),
    pp_TxnCurrency: "PKR",
    pp_TxnDateTime: dateTime,
    pp_BillReference: req.billReference.slice(0, 20),
    pp_Description: req.description.slice(0, 100),
    pp_TxnExpiryDateTime: expiryDateTime,
    pp_ReturnURL: req.returnUrl || cfg.returnUrl,
    pp_ProductID: "RETL",
    ppmpf_1: "",
    ppmpf_2: "",
    ppmpf_3: "",
    ppmpf_4: "",
    ppmpf_5: "",
  };

  fields.pp_SecureHash = generateSecureHash(fields, cfg.integritySalt);

  return {
    paymentUrl: cfg.paymentUrl,
    fields,
    sandbox: cfg.sandbox,
    isConfigured: isJazzCashConfigured(),
  };
}

const TERMINAL_ORDER: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
  OrderStatus.RETURNED,
  OrderStatus.DELIVERED,
];

export async function processJazzCashCallback(
  payload: Record<string, string>,
  opts?: { skipSignature?: boolean }
): Promise<{
  success: boolean;
  message: string;
  orderId?: string;
  alreadyProcessed?: boolean;
  needsRefundReview?: boolean;
  paymentId?: string;
  paidAmount?: number;
}> {
  const cfg = getConfig();
  const txnRefNo = payload.pp_TxnRefNo;
  const responseCode = payload.pp_ResponseCode;

  if (!txnRefNo) {
    return { success: false, message: "Missing transaction reference" };
  }

  // Unconfigured merchant: only allow explicit simulate helper (skipSignature).
  // Otherwise anyone with a txn ref could forge ResponseCode=000.
  if (!isJazzCashConfigured() && !opts?.skipSignature) {
    return {
      success: false,
      message: "JazzCash is not configured — payment callbacks are disabled",
    };
  }

  // Production: when merchant is configured, signature is mandatory
  if (isJazzCashConfigured() && !opts?.skipSignature) {
    if (!payload.pp_SecureHash) {
      return { success: false, message: "Missing payment signature" };
    }
    if (!verifySecureHash(payload, cfg.integritySalt)) {
      return { success: false, message: "Invalid payment signature" };
    }
  }

  const txn = await prisma.paymentTransaction.findUnique({
    where: { txnRefNo },
    include: { payment: true, order: true },
  });

  if (!txn) {
    return { success: false, message: "Transaction not found" };
  }

  if (txn.status === "SUCCESS" && txn.verifiedAt) {
    return {
      success: true,
      message: "Payment already processed",
      orderId: txn.orderId,
      alreadyProcessed: true,
    };
  }

  const expectedPaisa = toPaisa(Number(txn.amount));
  if (payload.pp_Amount && payload.pp_Amount !== expectedPaisa) {
    await prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: "FAILED",
        responsePayload: payload,
      },
    });
    return { success: false, message: "Amount mismatch", orderId: txn.orderId };
  }

  const isSuccess = responseCode === "000";

  return prisma.$transaction(async (tx) => {
    // Idempotency: only the first callback for this transaction may change money.
    // (Redirect + server callback, or a retried callback, can arrive at the same time.)
    const claimed = await tx.paymentTransaction.updateMany({
      where: { id: txn.id, status: { not: "SUCCESS" } },
      data: {
        status: isSuccess ? "SUCCESS" : "FAILED",
        responsePayload: payload,
        verifiedAt: isSuccess ? new Date() : null,
      },
    });
    if (claimed.count === 0) {
      return {
        success: true,
        message: "Payment already processed",
        orderId: txn.orderId,
        alreadyProcessed: true,
      };
    }

    await tx.payment.update({
      where: { id: txn.paymentId },
      data: {
        status: isSuccess ? "SUCCESS" : "FAILED",
        providerTxnId: payload.pp_RetrievalReferenceNo || payload.pp_TxnRefNo,
        paidAt: isSuccess ? new Date() : null,
        metadata: payload,
      },
    });

    if (!isSuccess) {
      if (
        txn.payment.type === "DELIVERY_FEE" ||
        txn.payment.type === "FULL_PAYMENT"
      ) {
        await tx.order.update({
          where: { id: txn.orderId },
          data: {
            deliveryFeePaymentStatus: "FAILED",
            ...(txn.payment.type === "FULL_PAYMENT"
              ? { productPaymentStatus: "FAILED" }
              : {}),
          },
        });
      } else if (txn.payment.type === "PRODUCT_AMOUNT") {
        await tx.order.update({
          where: { id: txn.orderId },
          data: { productPaymentStatus: "FAILED" },
        });
      }
      return {
        success: false,
        message: payload.pp_ResponseMessage || "Payment failed",
        orderId: txn.orderId,
      };
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: txn.orderId },
    });

    // Late payment after cancel/fail: record money but do NOT resurrect order
    if (TERMINAL_ORDER.includes(order.orderStatus)) {
      await tx.payment.update({
        where: { id: txn.paymentId },
        data: {
          metadata: {
            ...(payload as object),
            latePaymentOnTerminalOrder: true,
            orderStatusAtCallback: order.orderStatus,
          },
        },
      });
      return {
        success: true,
        message:
          "Payment received but order was already closed — admin must refund manually",
        orderId: txn.orderId,
        needsRefundReview: true,
        paymentId: txn.paymentId,
        paidAmount: Number(txn.amount),
      };
    }

    const paidAmount = Number(txn.amount);
    const bucket =
      txn.payment.type === "DELIVERY_FEE" ||
      txn.payment.type === "PRODUCT_AMOUNT" ||
      txn.payment.type === "FULL_PAYMENT"
        ? txn.payment.type
        : "FULL_PAYMENT";
    // Capped at what is due — a duplicate or oversized capture can never push
    // deliveryFeePaid / productAmountPaid above the order amounts (QA P2).
    const ledger = await lockAndAddPayment(tx, order.id, bucket, paidAmount);
    const locked = ledger.order;
    const productCod = locked.productPaymentStatus === "CASH_ON_DELIVERY";
    const nextStatus =
      locked.orderStatus === "PENDING_PAYMENT" ? "CONFIRMED" : locked.orderStatus;

    await tx.order.update({
      where: { id: order.id },
      data: {
        deliveryFeePaid: ledger.deliveryFeePaid,
        productAmountPaid: ledger.productAmountPaid,
        remainingAmount: productCod ? locked.remainingAmount : ledger.remainingAmount,
        ...(ledger.feeFullyPaid ? { deliveryFeePaymentStatus: "PAID" as const } : {}),
        ...(bucket !== "DELIVERY_FEE"
          ? {
              productPaymentStatus: ledger.productFullyPaid
                ? ("PAID" as const)
                : ("PARTIALLY_PAID" as const),
              paymentMethod: "JAZZCASH" as const,
            }
          : {}),
        orderStatus: nextStatus,
      },
    });
    if (ledger.excess > 0) {
      await tx.payment.update({
        where: { id: txn.paymentId },
        data: {
          metadata: {
            ...(payload as object),
            overpaidAmount: ledger.excess,
          },
        },
      });
    }

    // Promote fulfillments out of PENDING_PAYMENT
    if (nextStatus === "CONFIRMED") {
      await syncFulfillmentsToOrderStatus(tx, order.id, OrderStatus.CONFIRMED);
    }

    // If stores already marked ready while unpaid, catch order status up
    await syncOrderAfterFulfillmentReady(tx, order.id);

    // Append-only ledger: customer payment + sale/commission/earnings snapshot on
    // first confirmation (idempotent via the payment ref).
    await recordCustomerPaymentLedger(tx, {
      orderId: order.id,
      amount: paidAmount,
      refId: `jazzcash_${txn.paymentId}`,
    });
    if (locked.orderStatus === "PENDING_PAYMENT") {
      await recordOrderConfirmedLedger(tx, order.id);
    }

    return { success: true, message: "Payment verified", orderId: txn.orderId };
  });
}

/** Dev/sandbox helper when JazzCash credentials are not configured */
export async function simulateSuccessfulPayment(txnRefNo: string) {
  if (isJazzCashConfigured() && process.env.JAZZCASH_ALLOW_SIMULATE !== "true") {
    return {
      success: false,
      message: "Simulation disabled while JazzCash is configured",
    };
  }
  const txn = await prisma.paymentTransaction.findUnique({
    where: { txnRefNo },
  });
  return processJazzCashCallback(
    {
      pp_TxnRefNo: txnRefNo,
      pp_ResponseCode: "000",
      pp_ResponseMessage: "Success (simulated)",
      pp_Amount: txn ? toPaisa(Number(txn.amount)) : "",
      pp_SecureHash: "",
    },
    { skipSignature: true }
  );
}

/**
 * Rebuild / create a JazzCash payment form for a PENDING_PAYMENT order.
 */
export async function resumeOrderPayment(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId },
    include: {
      payments: {
        include: { transactions: { orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) throw new Error("Order not found");
  if (order.orderStatus !== "PENDING_PAYMENT") {
    throw new Error("Order does not require payment resume");
  }

  const pendingPayment = order.payments.find(
    (p) =>
      p.method === "JAZZCASH" &&
      ["INITIATED", "PENDING", "PROCESSING", "FAILED"].includes(p.status)
  );

  let amount = Number(order.deliveryFee);
  let paymentType: "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT" =
    "DELIVERY_FEE";

  if (pendingPayment) {
    amount = Number(pendingPayment.amount);
    paymentType = pendingPayment.type as typeof paymentType;
  } else {
    const productPending =
      order.productPaymentStatus === "PENDING" ||
      order.productPaymentStatus === "FAILED";
    const feePending =
      order.deliveryFeePaymentStatus === "PENDING" ||
      order.deliveryFeePaymentStatus === "INITIATED" ||
      order.deliveryFeePaymentStatus === "FAILED";
    const productTotal = Number(order.subtotal) - Number(order.discount);
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
  }

  if (amount <= 0) throw new Error("Nothing left to pay on this order");

  const txnRefNo = generateTxnRefNo("MB");
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      type: paymentType,
      method: "JAZZCASH",
      amount,
      status: "INITIATED",
      reference: txnRefNo,
    },
  });

  const paymentForm = buildJazzCashPaymentForm({
    amount,
    billReference: order.orderNumber,
    description: `MandiBazaar order ${order.orderNumber} (retry)`,
    txnRefNo,
  });

  await prisma.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      orderId: order.id,
      txnRefNo,
      amount,
      status: "INITIATED",
      idempotencyKey: `resume:${order.id}:${txnRefNo}`,
      requestPayload: paymentForm.fields,
    },
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

  return { order, paymentForm, txnRefNo };
}
