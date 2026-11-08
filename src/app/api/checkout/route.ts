import { getSession } from "@/lib/auth/auth";
import { checkoutSchema } from "@/lib/validators/schemas";
import { CheckoutError, createCheckoutOrder } from "@/lib/orders/checkout";
import { CouponError } from "@/lib/orders/coupons";
import { apiError, apiFieldErrors, apiSuccess, apiZodError, toUserMessage } from "@/lib/utils";
import { MSG, normalizePkMobile } from "@/lib/validators/pk";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in to checkout", 401);

  const rl = rateLimit(`checkout:${session.user.id}`, 10, 60_000);
  if (!rl.ok) return apiError("Too many checkout attempts. Please wait.", 429);

  try {
    const body = await req.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiZodError(parsed.error);
    }
    // S7: delivery phone must be a Pakistani mobile (03XXXXXXXXX)
    if (parsed.data.address && !normalizePkMobile(parsed.data.address.phone)) {
      return apiFieldErrors({ "address.phone": MSG.mobile });
    }

    const result = await createCheckoutOrder({
      userId: session.user.id,
      ...parsed.data,
    });

    return apiSuccess({
      order: {
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        orderStatus: result.order.orderStatus,
        subtotal: result.order.subtotal,
        discount: result.order.discount,
        deliveryFee: result.order.deliveryFee,
        grandTotal: result.order.grandTotal,
        deliveryFeePaid: result.order.deliveryFeePaid,
        productAmountPaid: result.order.productAmountPaid,
        remainingAmount: result.order.remainingAmount,
        paymentMethod: result.order.paymentMethod,
        deliveryFeePaymentStatus: result.order.deliveryFeePaymentStatus,
        productPaymentStatus: result.order.productPaymentStatus,
      },
      reused: result.reused,
      paymentForm: result.paymentForm,
      stripeCheckout: result.stripeCheckout || null,
      jazzcashQr: result.jazzcashQr || null,
      requiresJazzCash: Boolean(result.paymentForm),
      requiresStripe: Boolean(
        result.stripeCheckout?.clientSecret || result.stripeCheckout?.url
      ),
      requiresJazzCashQr: Boolean(result.jazzcashQr),
      message: result.stripeCheckout?.clientSecret
        ? "Enter your card details to complete payment."
        : result.stripeCheckout?.url
          ? "Redirecting to Stripe Checkout to complete payment."
          : result.jazzcashQr
            ? "Pay via JazzCash QR / Till ID, then upload your receipt."
            : result.paymentForm
              ? "Please complete JazzCash payment for the delivery fee (and products if selected)."
              : "Your order has been confirmed.",
    });
  } catch (e) {
    if (e instanceof CheckoutError) {
      if (e.fieldErrors) {
        return Response.json(
          { success: false, error: e.message, code: e.code, fieldErrors: e.fieldErrors },
          { status: 400 }
        );
      }
      return apiError(e.message, 400, e.code);
    }
    if (e instanceof CouponError) {
      return Response.json(
        {
          success: false,
          error: e.message,
          code: "COUPON",
          fieldErrors: { couponCode: e.message },
        },
        { status: 400 }
      );
    }
    console.error("[checkout]", e);
    return apiError(toUserMessage(e), 400);
  }
}
