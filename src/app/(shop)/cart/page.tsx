"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { applyCartQuoteToStore } from "@/lib/store/cart";
import { useSession } from "next-auth/react";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { EmptyState } from "@/components/layout/EmptyState";
import {
  readGuestCart,
  syncGuestCartWithQuote,
  updateGuestQty,
} from "@/lib/store/guest-cart";
import { ShoppingCart, Minus, Plus, Trash2, AlertTriangle } from "lucide-react";
import { DeliveryEtaNote } from "@/components/shop/DeliveryEtaNote";
import {
  CouponBox,
  recallCoupon,
  rememberCoupon,
  type CouponState,
} from "@/components/checkout/CouponBox";
import { useToast } from "@/components/ui/feedback";

type CartItem = {
  id: string;
  name: string;
  variantName?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl?: string | null;
  available: number;
  storeName?: string;
  storeOpen?: boolean;
  productActive?: boolean;
  stockNote?: string | null;
  productId?: string;
  variantId?: string | null;
};

type Quote = {
  subtotal: number;
  discount: number;
  productTotal: number;
  deliveryFee: number;
  deliveryKnown: boolean;
  deliveryMessage: string;
  isFreeDelivery: boolean;
  total: number;
  minimumOrder: { amount: number; met: boolean; shortBy: number; message: string | null };
  freeDelivery: {
    threshold: number;
    qualifies: boolean;
    shortBy: number;
    progressPct: number;
    message: string | null;
  };
  coupon: CouponState;
  /** Small orders: products + delivery fee in cash (owner decision 9) */
  fullCod?: { enabled: boolean; eligible: boolean; limit: number; message: string | null };
  stockIssues: string[];
  checkoutBlockers: string[];
  canCheckout: boolean;
};

const EMPTY_QUOTE: Quote = {
  subtotal: 0,
  discount: 0,
  productTotal: 0,
  deliveryFee: 0,
  deliveryKnown: false,
  deliveryMessage: "",
  isFreeDelivery: false,
  total: 0,
  minimumOrder: { amount: 0, met: true, shortBy: 0, message: null },
  freeDelivery: { threshold: 0, qualifies: false, shortBy: 0, progressPct: 0, message: null },
  coupon: null,
  stockIssues: [],
  checkoutBlockers: [],
  canCheckout: false,
};

function guestPayload(coupon?: string) {
  return {
    items: readGuestCart().map((g) => ({
      productId: g.productId,
      variantId: g.variantId || null,
      quantity: Math.min(1000, Math.max(1, Math.floor(g.quantity) || 1)),
    })),
    coupon: coupon || undefined,
  };
}

function canIncrease(item: CartItem) {
  return item.storeOpen !== false && item.productActive !== false && item.quantity < item.available;
}

export default function CartPage() {
  const { status } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<CartItem[]>([]);
  const [quote, setQuote] = useState<Quote>(EMPTY_QUOTE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  /** Code currently sent with every quote (applied or rejected) */
  const appliedCode = useRef("");
  const isGuest = status === "unauthenticated";
  const gen = useRef(0);

  const applyQuote = useCallback((data: Quote & { items: CartItem[] }) => {
    setItems(data.items || []);
    setQuote({ ...EMPTY_QUOTE, ...data });
    applyCartQuoteToStore(data);
    const c = data.coupon;
    if (c?.applied) rememberCoupon(c.code);
    else if (c && (c.reason === "NOT_FOUND" || c.reason === "INACTIVE" || c.reason === "EXPIRED")) {
      rememberCoupon(null);
    }
  }, []);

  const load = useCallback(
    async (couponCode?: string) => {
      const myGen = ++gen.current;
      setBusy(true);
      try {
        if (status === "authenticated") {
          const params = new URLSearchParams({ defaultAddress: "1" });
          if (couponCode) params.set("coupon", couponCode);
          const res = await fetch(`/api/cart?${params}`);
          const data = await res.json();
          if (myGen !== gen.current) return;
          if (data.success) applyQuote(data.data);
          else toast.error(data.error || "Could not load your cart");
        } else if (status === "unauthenticated") {
          if (!readGuestCart().length) {
            applyQuote({ ...EMPTY_QUOTE, items: [] });
            return;
          }
          let res = await fetch("/api/cart/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(guestPayload(couponCode)),
          });
          let data = await res.json();
          if (!data.success) {
            toast.error(data.error || "Could not load your cart");
            return;
          }
          // U2: cap guest quantities at live stock, then re-quote the capped cart
          const lowered = syncGuestCartWithQuote(data.data.items || [], data.data.missing || []);
          if (lowered.length || (data.data.missing || []).length) {
            res = await fetch("/api/cart/quote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(guestPayload(couponCode)),
            });
            data = await res.json();
            if (!data.success) return;
            for (const l of lowered) {
              toast.info(`Only ${l.to} of ${l.name} available — quantity set to ${l.to}.`);
            }
          }
          if (myGen !== gen.current) return;
          applyQuote(data.data);
        }
      } catch {
        toast.error("Could not load your cart. Check your connection and try again.");
      } finally {
        if (myGen === gen.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [status, applyQuote, toast]
  );

  const [notice, setNotice] = useState("");
  useEffect(() => {
    // Message from checkout when it sent the customer back (QA M9/U4)
    try {
      const n = sessionStorage.getItem("mb_cart_notice");
      if (n) {
        setNotice(n);
        sessionStorage.removeItem("mb_cart_notice");
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    const saved = recallCoupon();
    if (saved) {
      appliedCode.current = saved;
      setCouponInput(saved);
    }
    void load(saved || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function updateQty(item: CartItem, quantity: number) {
    if (quantity > item.quantity && !canIncrease(item)) {
      toast.info(item.available > 0 ? `Only ${item.available} left` : "Out of stock");
      return;
    }
    if (isGuest) {
      updateGuestQty(item.productId!, quantity, item.variantId);
      await load(appliedCode.current || undefined);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/cart", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, quantity }),
    });
    const data = await res.json().catch(() => null);
    if (!data?.success) toast.error(data?.error || "Could not update the quantity");
    await load(appliedCode.current || undefined);
  }

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    appliedCode.current = code;
    void load(code || undefined);
  }

  function removeCoupon() {
    appliedCode.current = "";
    setCouponInput("");
    rememberCoupon(null);
    void load();
  }

  if (loading) {
    return (
      <ShopContainer width="xl">
        <div className="skeleton h-72 rounded-2xl" />
      </ShopContainer>
    );
  }

  if (!items.length) {
    return (
      <ShopContainer width="md">
        {notice && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            {notice}
          </div>
        )}
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Browse products from local stores and add them to your cart."
          actionLabel="Browse products"
          actionHref="/products"
        />
      </ShopContainer>
    );
  }

  const fd = quote.freeDelivery;
  const blockers = quote.checkoutBlockers || [];

  return (
    <ShopContainer width="xl">
      <Breadcrumbs items={[{ label: "Cart" }]} />
      <PageHeader
        title="Shopping cart"
        subtitle={`${items.length} item${items.length !== 1 ? "s" : ""} in your cart`}
        badge={isGuest ? "Guest" : "Checkout"}
      />

      {isGuest && (
        <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          You are shopping as a guest.{" "}
          <Link
            href="/login?callbackUrl=/cart"
            className="font-semibold underline hover:text-brand-900"
          >
            Sign in
          </Link>{" "}
          to checkout, use coupons and save your cart.
        </div>
      )}

      {notice && quote.stockIssues.length === 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          {notice}
        </div>
      )}

      {quote.stockIssues.length > 0 && (
        <div
          className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="alert"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" /> Please fix your cart to continue
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {quote.stockIssues.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:gap-8">
        <div className="space-y-3">
          {items.map((item) => {
            const problem =
              item.storeOpen === false ||
              item.productActive === false ||
              item.available <= 0 ||
              item.quantity > item.available;
            return (
              <div
                key={item.id}
                className={`flex gap-3 rounded-2xl border bg-card p-3 shadow-card sm:gap-4 sm:p-4 ${
                  problem ? "border-amber-300" : "border-line"
                }`}
              >
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-24 sm:w-24">
                  {item.imageUrl && (
                    <Image src={item.imageUrl} alt={item.name} fill className="object-cover" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{item.name}</p>
                      <p className="text-xs text-ink-subtle">
                        {item.variantName || item.unit} · {formatCurrency(item.unitPrice)} each
                      </p>
                      {item.storeName && (
                        <p className="truncate text-[11px] text-ink-subtle">{item.storeName}</p>
                      )}
                    </div>
                    <p className="shrink-0 font-bold text-ink">
                      {formatCurrency(item.lineTotal)}
                    </p>
                  </div>
                  {item.stockNote && (
                    <p
                      className={`mt-1 text-xs font-medium ${
                        problem ? "text-amber-700" : "text-ink-subtle"
                      }`}
                    >
                      {item.stockNote}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="flex items-center rounded-xl border border-line bg-app">
                      <button
                        type="button"
                        className="rounded-l-xl p-2 text-ink-muted hover:bg-slate-100 disabled:opacity-40"
                        onClick={() => updateQty(item, item.quantity - 1)}
                        disabled={busy}
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        className="rounded-r-xl p-2 text-ink-muted hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => updateQty(item, item.quantity + 1)}
                        disabled={busy || !canIncrease(item)}
                        aria-label="Increase quantity"
                        title={!canIncrease(item) ? `Only ${item.available} available` : undefined}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs font-medium text-deal-600 hover:text-deal-700"
                      onClick={() => updateQty(item, 0)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="lg:sticky lg:top-36 lg:self-start">
          <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
            <h2 className="font-bold text-ink">Order summary</h2>
            <DeliveryEtaNote className="mt-3" compact />
            <div className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between text-ink-muted">
                <span>Products</span>
                <span>{formatCurrency(quote.subtotal)}</span>
              </div>
              {quote.discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Coupon discount</span>
                  <span>-{formatCurrency(quote.discount)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 text-ink-muted">
                <span>Delivery fee</span>
                <span
                  className={`text-right ${quote.isFreeDelivery ? "font-semibold text-emerald-600" : ""}`}
                >
                  {quote.isFreeDelivery
                    ? "FREE"
                    : quote.deliveryKnown
                      ? formatCurrency(quote.deliveryFee)
                      : "At checkout"}
                </span>
              </div>
              {quote.deliveryMessage && (
                <p className="text-[11px] leading-relaxed text-ink-subtle">
                  {quote.deliveryMessage}
                </p>
              )}
              {fd.threshold > 0 && !quote.isFreeDelivery && (
                <div className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-800">
                  <p>
                    Add <strong>{formatCurrency(fd.shortBy)}</strong> more of products for free
                    delivery (Rs {fd.threshold.toLocaleString("en-PK")}+)
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all"
                      style={{ width: `${fd.progressPct}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-3 text-base font-bold text-ink">
                <span>{quote.deliveryKnown || quote.isFreeDelivery ? "Total" : "Total before delivery"}</span>
                <span>{formatCurrency(quote.total)}</span>
              </div>
            </div>

            <div className="mt-4">
              <CouponBox
                value={couponInput}
                onChange={setCouponInput}
                onApply={applyCoupon}
                onRemove={removeCoupon}
                state={quote.coupon}
                busy={busy}
                isGuest={isGuest}
              />
            </div>

            {!quote.minimumOrder.met && quote.minimumOrder.message && (
              <div
                className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900"
                role="alert"
              >
                {quote.minimumOrder.message}
              </div>
            )}

            <div className="mt-4 rounded-xl bg-app p-3 text-xs leading-relaxed text-ink-muted">
              {quote.isFreeDelivery
                ? "No delivery fee on this order. Products: cash to rider or online."
                : quote.fullCod?.eligible
                  ? "Products: cash to rider or online · Delivery fee: online, or in cash with full cash on delivery."
                  : "Products: cash to rider or online · Delivery fee: paid online."}
              {quote.fullCod?.message && (
                <p className={`mt-1 font-medium ${quote.fullCod.eligible ? "text-emerald-700" : "text-ink-subtle"}`}>
                  {quote.fullCod.message}
                  {quote.fullCod.eligible ? " — your order qualifies." : "."}
                </p>
              )}
            </div>

            {isGuest ? (
              <Button
                href="/login?callbackUrl=/checkout"
                className="mt-5 w-full"
                size="lg"
              >
                Sign in to checkout
              </Button>
            ) : quote.canCheckout ? (
              <Button href="/checkout" className="mt-5 w-full" size="lg">
                Proceed to checkout
              </Button>
            ) : (
              <>
                <Button className="mt-5 w-full" size="lg" disabled>
                  Proceed to checkout
                </Button>
                {blockers[0] && (
                  <p className="mt-2 text-center text-xs text-amber-800">{blockers[0]}</p>
                )}
              </>
            )}
            <Link
              href="/products"
              className="mt-3 block text-center text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Continue shopping
            </Link>
          </div>
        </aside>
      </div>
    </ShopContainer>
  );
}
