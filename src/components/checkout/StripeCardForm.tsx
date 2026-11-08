"use client";

import { FormEvent, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";

const stripePromises = new Map<string, Promise<Stripe | null>>();

function getStripePromise(publishableKey: string) {
  let p = stripePromises.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromises.set(publishableKey, p);
  }
  return p;
}

type Props = {
  clientSecret: string;
  publishableKey: string;
  orderNumber: string;
  amountPkr: number;
  onSuccess: (orderNumber: string) => void;
  onError: (message: string) => void;
};

function CardPayInner({
  orderNumber,
  amountPkr,
  onSuccess,
  onError,
}: Omit<Props, "clientSecret" | "publishableKey">) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setLocalError("");
    onError("");

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}/checkout/confirmation?order=${encodeURIComponent(orderNumber)}`,
      },
    });

    if (error) {
      const msg = error.message || "Card payment failed";
      setLocalError(msg);
      onError(msg);
      setBusy(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      try {
        const res = await fetch("/api/stripe/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
        });
        const data = await res.json();
        if (!data.success) {
          const msg = data.error || "Payment received but order update failed";
          setLocalError(msg);
          onError(msg);
          setBusy(false);
          return;
        }
        onSuccess(data.data.orderNumber || orderNumber);
      } catch {
        onError("Network error after payment");
        setBusy(false);
      }
      return;
    }

    setLocalError("Payment requires extra verification. Please try again.");
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-xl border border-line bg-app p-4">
        <p className="mb-3 text-sm font-semibold text-ink">
          Enter card details
        </p>
        <PaymentElement
          options={{
            layout: "tabs",
            fields: { billingDetails: { address: "auto" } },
          }}
        />
      </div>
      {localError && (
        <p className="text-sm text-red-600">{localError}</p>
      )}
      <Button type="submit" disabled={!stripe || busy} className="w-full">
        {busy ? "Charging card…" : `Pay ${formatCurrency(amountPkr)}`}
      </Button>
      <p className="text-center text-[11px] text-ink-subtle">
        Card details are processed securely by Stripe. We never store your full
        card number.
      </p>
    </form>
  );
}

export function StripeCardForm(props: Props) {
  const { clientSecret, publishableKey, ...rest } = props;
  return (
    <Elements
      stripe={getStripePromise(publishableKey)}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#059669",
            borderRadius: "12px",
          },
        },
      }}
    >
      <CardPayInner {...rest} />
    </Elements>
  );
}
