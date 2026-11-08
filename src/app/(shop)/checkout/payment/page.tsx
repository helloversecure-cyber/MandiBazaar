"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { StripeCardForm } from "@/components/checkout/StripeCardForm";

function PaymentStatus() {
  const sp = useSearchParams();
  const router = useRouter();
  const error = sp.get("error");
  const order = sp.get("order");
  const orderId = sp.get("orderId");
  const wantCard = sp.get("card") === "1";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [stripePay, setStripePay] = useState<{
    clientSecret: string;
    publishableKey: string;
    orderNumber: string;
    amountPkr: number;
  } | null>(null);

  useEffect(() => {
    if (!wantCard) return;
    try {
      const raw = sessionStorage.getItem("mb_stripe_pay");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        clientSecret: string;
        publishableKey: string;
        orderNumber: string;
        amountPkr: number;
      };
      if (parsed.clientSecret && parsed.publishableKey) {
        setStripePay(parsed);
        sessionStorage.removeItem("mb_stripe_pay");
      }
    } catch {
      /* ignore */
    }
  }, [wantCard]);

  async function resumePayment() {
    if (!orderId && !order) {
      setMsg("Missing order reference — open the order from My orders.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      let id = orderId;
      if (!id && order) {
        const oRes = await fetch(`/api/orders/${encodeURIComponent(order)}`);
        const oData = await oRes.json();
        if (!oData.success) {
          setMsg(oData.error || "Order not found");
          setBusy(false);
          return;
        }
        id = oData.data.id;
      }
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESUME_PAYMENT", orderId: id }),
      });
      const data = await res.json();
      if (!data.success) {
        setMsg(data.error || "Could not resume payment");
        setBusy(false);
        return;
      }

      if (data.data.stripeCheckout?.clientSecret) {
        setStripePay({
          clientSecret: data.data.stripeCheckout.clientSecret,
          publishableKey: data.data.stripeCheckout.publishableKey,
          orderNumber: data.data.orderNumber,
          amountPkr: data.data.stripeCheckout.amountPkr || 0,
        });
        setBusy(false);
        return;
      }

      if (data.data.stripeCheckout?.url) {
        window.location.assign(data.data.stripeCheckout.url);
        return;
      }

      const form = data.data.paymentForm;
      if (!form?.isConfigured) {
        setMsg(
          form
            ? "JazzCash is not available. Use card payment or contact support."
            : "No payment method is configured. Please try again later."
        );
        setBusy(false);
        return;
      }
      const el = document.createElement("form");
      el.method = "POST";
      el.action = form.paymentUrl;
      Object.entries(form.fields as Record<string, string>).forEach(
        ([k, v]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = v;
          el.appendChild(input);
        }
      );
      document.body.appendChild(el);
      el.submit();
    } catch {
      setMsg("Network error while resuming payment");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="font-display text-3xl text-ink">
        {error ? "Payment could not be completed" : "Your payment is being verified"}
      </h1>
      <p className="mt-3 text-sm text-ink-subtle">
        {error
          ? decodeURIComponent(error)
          : "If you closed the browser during payment, your order status will update once payment confirms."}
      </p>
      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

      {stripePay ? (
        <div className="mt-8 text-left">
          <StripeCardForm
            clientSecret={stripePay.clientSecret}
            publishableKey={stripePay.publishableKey}
            orderNumber={stripePay.orderNumber}
            amountPkr={stripePay.amountPkr}
            onSuccess={(orderNumber) => {
              router.push(
                `/checkout/confirmation?order=${encodeURIComponent(orderNumber)}`
              );
            }}
            onError={(message) => setMsg(message)}
          />
        </div>
      ) : (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {order && (
            <Button href={`/account/orders/${order}`}>View order</Button>
          )}
          {(order || orderId) && (
            <Button type="button" onClick={resumePayment} disabled={busy}>
              {busy ? "Preparing…" : "Retry payment"}
            </Button>
          )}
          <Button href="/account/orders" variant="outline">
            My orders
          </Button>
        </div>
      )}
      <Link href="/" className="mt-6 block text-sm text-ink-subtle">
        Back home
      </Link>
    </div>
  );
}

export default function CheckoutPaymentPage() {
  return (
    <Suspense>
      <PaymentStatus />
    </Suspense>
  );
}
