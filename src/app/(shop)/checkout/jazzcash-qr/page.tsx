"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { formatCurrency } from "@/lib/utils";

function JazzCashQrPay() {
  const sp = useSearchParams();
  const router = useRouter();
  const orderNumber = sp.get("order") || "";
  const orderId = sp.get("orderId") || "";
  const amountParam = Number(sp.get("amount") || 0);

  const [amountPkr, setAmountPkr] = useState(amountParam);
  const [tillId, setTillId] = useState("980803336");
  const [merchantName, setMerchantName] = useState("ybs services");
  const [qrImageUrl, setQrImageUrl] = useState("/payments/jazzcash-till-qr.jpg");
  const [ussdHint, setUssdHint] = useState(
    "Dial *786*10# and enter TILL ID to pay via JazzCash."
  );
  const [receiptUrl, setReceiptUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/payments/config")
      .then((r) => r.json())
      .then((d) => {
        if (!d.success || !d.data.jazzcashQr?.enabled) return;
        const q = d.data.jazzcashQr;
        setTillId(q.tillId);
        setMerchantName(q.merchantName);
        setQrImageUrl(q.qrImageUrl);
        setUssdHint(q.ussdHint);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (amountParam > 0 || !orderNumber) return;
    fetch(`/api/orders/${encodeURIComponent(orderNumber)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const o = d.data;
        const feePending = ["PENDING", "INITIATED", "FAILED"].includes(
          o.deliveryFeePaymentStatus
        );
        const productPending =
          o.productPaymentStatus === "PENDING" ||
          o.productPaymentStatus === "FAILED";
        const productTotal = Math.max(
          0,
          Number(o.subtotal) - Number(o.discount)
        );
        if (feePending && productPending) setAmountPkr(Number(o.grandTotal));
        else if (feePending) setAmountPkr(Number(o.deliveryFee));
        else if (productPending) setAmountPkr(productTotal);
      })
      .catch(() => undefined);
  }, [amountParam, orderNumber]);

  async function submitReceipt() {
    if (!orderId) {
      setError("Missing order. Open this page from checkout again.");
      return;
    }
    if (!receiptUrl) {
      setError("Please upload your JazzCash payment receipt screenshot.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/orders/payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          imageUrl: receiptUrl,
          notes: "Customer JazzCash Till/QR receipt",
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Could not submit receipt");
        setBusy(false);
        return;
      }
      setDone(true);
      setMsg(data.data.message);
      setBusy(false);
      setTimeout(() => {
        router.push(
          `/checkout/confirmation?order=${encodeURIComponent(
            data.data.orderNumber || orderNumber
          )}`
        );
      }, 1200);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (!orderNumber || !orderId) {
    return (
      <ShopContainer width="md">
        <div className="rounded-2xl bg-card p-6 shadow-sm">
          <p className="text-ink-muted">Missing order reference.</p>
          <Link href="/account/orders" className="mt-4 inline-block text-brand-700 underline">
            Go to My orders
          </Link>
        </div>
      </ShopContainer>
    );
  }

  return (
    <ShopContainer width="md">
      <div className="rounded-2xl bg-card p-5 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
          JazzCash QR / Till
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">
          Pay for order {orderNumber}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Pay <strong>{formatCurrency(amountPkr || 0)}</strong> to{" "}
          <strong>{merchantName}</strong>, then upload your receipt below.
        </p>

        <div className="mx-auto mt-6 max-w-xs overflow-hidden rounded-2xl border border-line bg-amber-300">
          <div className="relative aspect-square w-full">
            <Image
              src={qrImageUrl}
              alt="JazzCash Till QR code"
              fill
              className="object-contain"
              sizes="320px"
              priority
              unoptimized
            />
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-app px-4 py-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
            Till ID
          </p>
          <p className="mt-1 font-mono text-2xl font-extrabold tracking-widest text-ink">
            {tillId}
          </p>
          <p className="mt-2 text-xs text-ink-subtle">{ussdHint}</p>
        </div>

        <div className="mt-8 space-y-3 border-t border-line pt-6">
          <h2 className="text-lg font-bold text-ink">
            Confirm payment
          </h2>
          <p className="text-sm text-ink-muted">
            After paying, upload the JazzCash success screenshot / receipt.
            MandiBazaar will verify and confirm your order.
          </p>
          <ImageUploadField
            label="Payment receipt"
            value={receiptUrl}
            onChange={setReceiptUrl}
            required
            folder="payment-proofs"
            kind="business"
            hint="Clear screenshot of the paid JazzCash transaction"
          />
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          {msg && (
            <p className="text-sm text-emerald-700">{msg}</p>
          )}
          <Button
            className="w-full"
            disabled={busy || done || !receiptUrl}
            onClick={submitReceipt}
          >
            {busy
              ? "Submitting…"
              : done
                ? "Submitted"
                : "Confirm payment — submit receipt"}
          </Button>
          <p className="text-center text-xs text-ink-subtle">
            Order stays pending until an admin verifies your receipt.
          </p>
        </div>
      </div>
    </ShopContainer>
  );
}

export default function JazzCashQrCheckoutPage() {
  return (
    <Suspense
      fallback={
        <ShopContainer width="md">
          <div className="skeleton h-64 rounded-2xl" />
        </ShopContainer>
      }
    >
      <JazzCashQrPay />
    </Suspense>
  );
}
