"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { nanoid } from "nanoid";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CheckoutSteps } from "@/components/layout/CheckoutSteps";
import { StripeCardForm } from "@/components/checkout/StripeCardForm";
import { DeliveryEtaNote } from "@/components/shop/DeliveryEtaNote";
import {
  CouponBox,
  recallCoupon,
  rememberCoupon,
  type CouponState,
} from "@/components/checkout/CouponBox";
import { FieldError, FormError } from "@/components/ui/FieldError";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import {
  PK_CITIES,
  PK_PROVINCES,
  normalizePkMobile,
  optional,
  validateFields,
  zEmail,
  zPersonName,
  zMobile,
} from "@/lib/validators/pk";
import { addressSchema } from "@/lib/validators/schemas";
import {
  STRIPE_MIN_AMOUNT_PKR,
  onlineAmountFor,
  stripeMinimumMessage,
} from "@/lib/payments/card-minimum";

const inputCls =
  "w-full rounded-xl border border-line bg-app px-4 py-3 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100";
const inputErrCls =
  "w-full rounded-xl border border-red-400 bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2 focus:ring-red-200";

/** Step 1 rules (QA S7/M7): Pakistani mobile 03XXXXXXXXX, error under the field. */
const customerSchema = z.object({
  fullName: zPersonName,
  phone: zMobile,
  email: optional(zEmail),
});

type Address = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  houseBuilding: string;
  street?: string;
  area: string;
  city: string;
  province: string;
  postalCode?: string;
  nearbyLandmark?: string;
  deliveryInstructions?: string;
  latitude?: number | null;
  longitude?: number | null;
};

type AddressQuote = {
  addressId: string;
  deliveryFee: number;
  isFree: boolean;
  reason: string;
  oneWayKm: number;
  distanceKm: number;
};

type Summary = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  productTotal: number;
  isFreeDelivery: boolean;
  freeDeliveryThreshold: number;
  freeDeliveryShortBy: number;
  deliveryReason: string;
  items: { name: string; quantity: number; lineTotal: number }[];
  coupon: CouponState;
  /** Small orders: products + delivery fee in cash (owner decision 9) */
  fullCod: { enabled: boolean; eligible: boolean; limit: number; message: string | null } | null;
  checkoutBlockers: string[];
  /** Set when the customer accepted a rider's bid — delivery fee is that bid. */
  deliveryBid: { fee: number } | null;
  loaded: boolean;
};

type PaymentChoice = "ONLINE" | "CASH_ON_DELIVERY" | "FULL_COD";

const EMPTY_SUMMARY: Summary = {
  subtotal: 0,
  discount: 0,
  deliveryFee: 0,
  total: 0,
  productTotal: 0,
  isFreeDelivery: false,
  freeDeliveryThreshold: 0,
  freeDeliveryShortBy: 0,
  deliveryReason: "",
  deliveryBid: null,
  items: [],
  coupon: null,
  fullCod: null,
  checkoutBlockers: [],
  loaded: false,
};

/** Cart-level problems send the customer back to the cart with the reason (QA M9/U4). */
const BACK_TO_CART_CODES = ["EMPTY_CART", "CART_ISSUES", "CART_CHANGED", "MIN_ORDER"];

export default function CheckoutPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fe = useFieldErrors();
  const [step, setStep] = useState(1);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressQuotes, setAddressQuotes] = useState<AddressQuote[]>([]);
  const [addressId, setAddressId] = useState("");
  const [useNewAddress, setUseNewAddress] = useState(false);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [productPaymentChoice, setProductPaymentChoice] =
    useState<PaymentChoice>("CASH_ON_DELIVERY");
  const [payConfig, setPayConfig] = useState<{
    preferredOnline: string;
    stripeEnabled: boolean;
    jazzcashEnabled: boolean;
    jazzcashQrEnabled: boolean;
    stripeMinAmount: number;
  }>({
    preferredOnline: "NONE",
    stripeEnabled: false,
    jazzcashEnabled: false,
    jazzcashQrEnabled: true,
    stripeMinAmount: STRIPE_MIN_AMOUNT_PKR,
  });
  const [onlineProvider, setOnlineProvider] = useState<"STRIPE" | "JAZZCASH_QR">(
    "STRIPE"
  );
  const [couponInput, setCouponInput] = useState("");
  /** Code sent with every cart quote; only an APPLIED code is sent with the order */
  const couponCode = useRef("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [stripePay, setStripePay] = useState<{
    clientSecret: string;
    publishableKey: string;
    orderNumber: string;
    amountPkr: number;
  } | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    houseBuilding: "",
    street: "",
    area: "",
    city: "Lahore",
    province: "Punjab",
    postalCode: "",
    nearbyLandmark: "",
    deliveryInstructions: "",
    label: "Home",
  });

  // A new key after every failed attempt (the server either created no order or
  // rolled it back), the same key while a request may still be in flight.
  const [idempotencyKey, setIdempotencyKey] = useState(() => nanoid(16));
  const cartLoadGen = useRef(0);
  const prefilled = useRef(false);

  const quoteByAddress = useMemo(() => {
    const map = new Map<string, AddressQuote>();
    for (const q of addressQuotes) map.set(q.addressId, q);
    return map;
  }, [addressQuotes]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/checkout");
    }
  }, [status, router]);

  // S7/M7: prefill name / phone / email from the signed-in account
  useEffect(() => {
    if (status !== "authenticated" || prefilled.current) return;
    prefilled.current = true;
    const u = session?.user;
    const email = u?.email && u.email.includes("@") ? u.email : "";
    setForm((f) => ({
      ...f,
      fullName: f.fullName || u?.name || "",
      phone: f.phone || normalizePkMobile(u?.phone || "") || u?.phone || "",
      email: f.email || email,
    }));
  }, [status, session]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const saved = recallCoupon();
    if (saved) {
      couponCode.current = saved;
      setCouponInput(saved);
    }
    fetch("/api/addresses")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const list = (d.data || []) as Address[];
          setAddresses(list);
          if (list[0]) {
            setAddressId(list[0].id);
            setUseNewAddress(false);
            void loadCart({ addressId: list[0].id, withQuotes: true });
          } else {
            setUseNewAddress(true);
            void loadCart({ withQuotes: true });
          }
        } else {
          void loadCart({ withQuotes: true });
        }
      })
      .catch(() => void loadCart({ withQuotes: true }));
    fetch("/api/payments/config")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const stripeOn = Boolean(d.data.stripe?.enabled);
          const qrOn = Boolean(d.data.jazzcashQr?.enabled);
          setPayConfig({
            preferredOnline: d.data.preferredOnline,
            stripeEnabled: stripeOn,
            jazzcashEnabled: Boolean(d.data.jazzcash?.enabled),
            jazzcashQrEnabled: qrOn,
            stripeMinAmount: Number(d.data.stripe?.minAmountPkr) || STRIPE_MIN_AMOUNT_PKR,
          });
          setOnlineProvider(stripeOn ? "STRIPE" : "JAZZCASH_QR");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const onlinePayAvailable =
    payConfig.stripeEnabled ||
    payConfig.jazzcashEnabled ||
    payConfig.jazzcashQrEnabled;

  // Owner decision 9: small orders may pay products + delivery fee in cash
  const fullCodEligible = Boolean(summary.fullCod?.eligible) && summary.deliveryFee > 0;
  const fullCodChosen = productPaymentChoice === "FULL_COD" && fullCodEligible;
  const cashToRider =
    productPaymentChoice === "ONLINE"
      ? 0
      : summary.productTotal + (fullCodChosen ? summary.deliveryFee : 0);

  // M12/M13: the online amount always follows the current payment choice
  const onlineAmount = fullCodChosen
    ? 0
    : onlineAmountFor({
        deliveryFee: summary.deliveryFee,
        productTotal: summary.productTotal,
        payProductsOnline: productPaymentChoice === "ONLINE",
      });
  const needsOnline =
    (summary.deliveryFee > 0 && !fullCodChosen) || productPaymentChoice === "ONLINE";
  const cardAllowed = onlineAmount >= payConfig.stripeMinAmount;
  const jazzCashAvailable = payConfig.jazzcashQrEnabled;
  const cardNote = !cardAllowed
    ? stripeMinimumMessage({
        onlineAmount,
        deliveryFee: summary.deliveryFee,
        payProductsOnline: productPaymentChoice === "ONLINE",
        jazzCashAvailable,
      })
    : "";
  const effectiveProvider: "STRIPE" | "JAZZCASH_QR" =
    !payConfig.stripeEnabled || (onlineProvider === "JAZZCASH_QR" && jazzCashAvailable)
      ? "JAZZCASH_QR"
      : onlineProvider;
  const cardBlocked =
    needsOnline && payConfig.stripeEnabled && effectiveProvider === "STRIPE" && !cardAllowed;

  // Order no longer qualifies (coupon removed, address changed…) → back to normal COD
  useEffect(() => {
    if (productPaymentChoice === "FULL_COD" && summary.loaded && !fullCodEligible) {
      setProductPaymentChoice("CASH_ON_DELIVERY");
    }
  }, [productPaymentChoice, fullCodEligible, summary.loaded]);

  // Card not possible for this amount → switch to JazzCash automatically (if offered)
  useEffect(() => {
    if (onlineProvider === "STRIPE" && !cardAllowed && jazzCashAvailable && summary.loaded) {
      setOnlineProvider("JAZZCASH_QR");
    }
  }, [onlineProvider, cardAllowed, jazzCashAvailable, summary.loaded]);

  function goBackToCart(reason: string) {
    try {
      sessionStorage.setItem("mb_cart_notice", reason);
    } catch {
      /* ignore */
    }
    router.replace("/cart");
  }

  async function loadCart(opts?: {
    addressId?: string;
    city?: string;
    area?: string;
    withQuotes?: boolean;
  }): Promise<Summary | null> {
    const gen = ++cartLoadGen.current;
    const params = new URLSearchParams();
    if (couponCode.current) params.set("coupon", couponCode.current);
    if (opts?.withQuotes !== false) params.set("quotes", "1");

    const selectedId =
      opts?.addressId !== undefined
        ? opts.addressId
        : !useNewAddress
          ? addressId
          : "";

    if (selectedId) {
      params.set("addressId", selectedId);
    } else {
      params.set("city", opts?.city || form.city || "Lahore");
      if (opts?.area || form.area) {
        params.set("area", opts?.area || form.area);
      }
      if (form.houseBuilding) params.set("houseBuilding", form.houseBuilding);
      const phone = normalizePkMobile(form.phone);
      if (phone) params.set("phone", phone);
    }

    try {
      const res = await fetch(`/api/cart?${params}`);
      const data = await res.json();
      // Ignore stale responses when user switches addresses quickly
      if (gen !== cartLoadGen.current) return null;
      if (!data.success) return null;
      const next: Summary = {
        subtotal: data.data.subtotal,
        discount: data.data.discount,
        deliveryFee: data.data.deliveryFee,
        total: data.data.total,
        productTotal: data.data.productTotal,
        isFreeDelivery: Boolean(data.data.isFreeDelivery),
        freeDeliveryThreshold: data.data.freeDeliveryThreshold ?? 0,
        freeDeliveryShortBy: data.data.freeDelivery?.shortBy ?? 0,
        deliveryReason: data.data.deliveryReason || "",
        items: data.data.items || [],
        coupon: data.data.coupon || null,
        fullCod: data.data.fullCod || null,
        checkoutBlockers: data.data.checkoutBlockers || [],
        deliveryBid: data.data.deliveryBid || null,
        loaded: true,
      };
      setSummary(next);
      if (next.coupon?.applied) rememberCoupon(next.coupon.code);
      if (Array.isArray(data.data.addressQuotes)) {
        setAddressQuotes(data.data.addressQuotes);
      }
      // M9: empty cart / unavailable items / below minimum → back to the cart
      if (next.items.length === 0) {
        goBackToCart("Your cart is empty. Add products before checking out.");
      } else if (next.checkoutBlockers.length > 0) {
        goBackToCart(next.checkoutBlockers.join(" "));
      }
      return next;
    } catch {
      if (gen === cartLoadGen.current) setError("Could not load your cart. Please try again.");
      return null;
    }
  }

  function quoteOptsForCurrentAddress() {
    return !useNewAddress && addressId
      ? { addressId, withQuotes: true }
      : { city: form.city, area: form.area, withQuotes: true };
  }

  /** Re-check the cart before moving on (QA M9). False = stay / redirected. */
  async function recheck(): Promise<boolean> {
    const s = await loadCart(quoteOptsForCurrentAddress());
    return Boolean(s && s.items.length > 0 && s.checkoutBlockers.length === 0);
  }

  function validateCustomer(): boolean {
    return fe.check(customerSchema, {
      fullName: form.fullName,
      phone: form.phone,
      email: form.email,
    });
  }

  function newAddressPayload() {
    return {
      label: form.label.trim() || "Home",
      fullName: form.fullName.trim(),
      phone: normalizePkMobile(form.phone) || form.phone.trim(),
      houseBuilding: form.houseBuilding.trim(),
      street: form.street.trim() || undefined,
      area: form.area.trim(),
      city: form.city,
      province: form.province,
      postalCode: form.postalCode.trim() || undefined,
      nearbyLandmark: form.nearbyLandmark.trim() || undefined,
      deliveryInstructions: form.deliveryInstructions.trim() || undefined,
    };
  }

  /** Same rules as the server's addressSchema; errors go under each field. */
  function validateAddress(): { message: string; step: number } | null {
    if (!useNewAddress && addressId) return null;
    const errs = validateFields(addressSchema, newAddressPayload());
    if (!errs) return null;
    fe.setErrors(errs);
    fe.setFormError("");
    const onStep1 = Boolean(errs.fullName || errs.phone);
    return {
      message: onStep1
        ? "Please check your name and mobile number"
        : "Please fix the highlighted address fields",
      step: onStep1 ? 1 : 2,
    };
  }

  /** Server fieldErrors keyed "address.<field>" → under the matching field. */
  function applyServerFieldErrors(fieldErrors: Record<string, string>): number {
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldErrors)) {
      mapped[k.startsWith("address.") ? k.slice(8) : k] = v;
    }
    fe.setErrors(mapped);
    fe.setFormError("");
    return mapped.fullName || mapped.phone ? 1 : 2;
  }

  async function goToStep2() {
    if (!validateCustomer()) return;
    setError("");
    if (!(await recheck())) return;
    setStep(2);
  }

  async function goToStep3() {
    const err = validateAddress();
    if (err) {
      setError(err.message);
      setStep(err.step);
      return;
    }
    fe.clear();
    setError("");
    if (!(await recheck())) return;
    setStep(3);
  }

  async function goToStep4() {
    setError("");
    if (!(await recheck())) return;
    setStripePay(null);
    setStep(4);
  }

  async function applyCoupon() {
    couponCode.current = couponInput.trim().toUpperCase();
    setCouponBusy(true);
    await loadCart(quoteOptsForCurrentAddress());
    setCouponBusy(false);
  }

  async function removeCoupon() {
    couponCode.current = "";
    setCouponInput("");
    rememberCoupon(null);
    setCouponBusy(true);
    await loadCart(quoteOptsForCurrentAddress());
    setCouponBusy(false);
  }

  function choosePayment(choice: PaymentChoice) {
    // M13: a new choice means a new amount — drop the old error / card form
    setProductPaymentChoice(choice);
    setStripePay(null);
    setError("");
  }

  function chooseProvider(p: "STRIPE" | "JAZZCASH_QR") {
    setOnlineProvider(p);
    setStripePay(null);
    setError("");
  }

  async function placeOrder() {
    if (!validateCustomer()) {
      setStep(1);
      return;
    }
    const addressErr = validateAddress();
    if (addressErr) {
      setError(addressErr.message);
      setStep(addressErr.step);
      return;
    }

    if (needsOnline && !onlinePayAvailable) {
      setError(
        "Online payment is temporarily unavailable. Please try again later."
      );
      return;
    }
    if (cardBlocked) {
      setError(cardNote);
      return;
    }

    setProcessing(true);
    setError("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
    let keepKey = false;
    try {
      const payload: Record<string, unknown> = {
        productPaymentChoice:
          productPaymentChoice === "FULL_COD" && !fullCodChosen
            ? "CASH_ON_DELIVERY"
            : productPaymentChoice,
        notes,
        couponCode: summary.coupon?.applied ? summary.coupon.code : undefined,
        idempotencyKey,
      };
      if (needsOnline) payload.onlineProvider = effectiveProvider;
      if (!useNewAddress && addressId) {
        payload.addressId = addressId;
      } else {
        payload.address = newAddressPayload();
      }

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let data: {
        success?: boolean;
        error?: string;
        code?: string;
        fieldErrors?: Record<string, string>;
        data?: {
          order?: { orderNumber?: string; orderStatus?: string };
          stripeCheckout?: {
            clientSecret?: string;
            publishableKey?: string;
            url?: string | null;
            amountPkr?: number;
          };
          paymentForm?: {
            isConfigured?: boolean;
            paymentUrl?: string;
            fields?: Record<string, string>;
          };
          jazzcashQr?: {
            orderNumber: string;
            orderId: string;
            amountPkr: number;
          };
          requiresStripe?: boolean;
          requiresJazzCash?: boolean;
          requiresJazzCashQr?: boolean;
        };
      };
      try {
        data = await res.json();
      } catch {
        keepKey = true; // unknown outcome — retry must reuse the same order
        setError("Checkout failed — invalid server response. Please try again.");
        return;
      }
      if (!data.success) {
        const code = data.code || "";
        if (BACK_TO_CART_CODES.includes(code)) {
          goBackToCart(data.error || "Please review your cart.");
          return;
        }
        if (code === "NO_RIDER") {
          // Bid expired or no rider chosen — send them back to the live auction.
          setError(data.error || "Choose a rider for your delivery first.");
          window.location.href = "/checkout/riders";
          return;
        }
        if (code === "FULL_COD") {
          // Server says this order can't pay the fee in cash (limit / setting changed)
          await loadCart(quoteOptsForCurrentAddress());
          setProductPaymentChoice("CASH_ON_DELIVERY");
          setError(data.error || "Please pay the delivery fee online for this order.");
          return;
        }
        if (code === "COUPON") {
          await loadCart(quoteOptsForCurrentAddress());
          setStep(3);
          setError(data.error || "Your coupon can't be used on this order.");
          return;
        }
        if (data.fieldErrors && Object.keys(data.fieldErrors).length) {
          setStep(applyServerFieldErrors(data.fieldErrors));
          setError(data.error || "Please fix the highlighted fields");
          return;
        }
        setError(data.error || "Checkout failed");
        return;
      }

      keepKey = true;
      rememberCoupon(null);

      // Stripe in-app card form
      if (data.data?.stripeCheckout?.clientSecret) {
        setStripePay({
          clientSecret: data.data.stripeCheckout.clientSecret,
          publishableKey: data.data.stripeCheckout.publishableKey || "",
          orderNumber: data.data.order?.orderNumber || "",
          amountPkr: data.data.stripeCheckout.amountPkr || onlineAmount,
        });
        return;
      }

      // Legacy hosted Checkout redirect (if ever returned)
      if (data.data?.stripeCheckout?.url) {
        window.location.assign(data.data.stripeCheckout.url);
        return;
      }

      if (data.data?.paymentForm?.isConfigured) {
        // Auto-submit JazzCash form
        const { paymentUrl, fields } = data.data.paymentForm;
        const formEl = document.createElement("form");
        formEl.method = "POST";
        formEl.action = paymentUrl || "";
        Object.entries(fields || {}).forEach(([k, v]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = String(v);
          formEl.appendChild(input);
        });
        document.body.appendChild(formEl);
        formEl.submit();
        return;
      }

      const q = data.data?.jazzcashQr;
      if (data.data?.requiresJazzCashQr && q?.orderId && q?.orderNumber) {
        // Hard navigate — soft router.push can leave this screen stuck on "Preparing…"
        window.location.assign(
          `/checkout/jazzcash-qr?order=${encodeURIComponent(q.orderNumber)}&orderId=${encodeURIComponent(q.orderId)}&amount=${encodeURIComponent(String(q.amountPkr || 0))}`
        );
        return;
      }

      if (
        data.data?.order?.orderStatus === "PENDING_PAYMENT" &&
        !data.data.requiresStripe &&
        !data.data.requiresJazzCash &&
        !data.data.requiresJazzCashQr
      ) {
        setError(
          "We could not start payment. Please try again or resume from My orders."
        );
        return;
      }

      const confirmedOrder = data.data?.order?.orderNumber;
      if (confirmedOrder) {
        window.location.assign(
          `/checkout/confirmation?order=${encodeURIComponent(confirmedOrder)}`
        );
        return;
      }
      setError("Checkout completed but no next step was returned. Please open My orders.");
    } catch (e) {
      // Timeout / network: the order may exist — keep the key so a retry reuses it
      keepKey = true;
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Payment setup timed out. Please try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (!keepKey) setIdempotencyKey(nanoid(16));
      setProcessing(false);
    }
  }

  if (status === "loading" || (status === "authenticated" && !summary.loaded)) {
    return (
      <ShopContainer width="lg">
        <div className="skeleton h-64 rounded-2xl" />
      </ShopContainer>
    );
  }

  const payProductsOnline = productPaymentChoice === "ONLINE";

  return (
    <ShopContainer width="lg">
      <Breadcrumbs items={[{ label: "Cart", href: "/cart" }, { label: "Checkout" }]} />
      <PageHeader title="Checkout" subtitle="Complete your order in a few steps" badge="Secure" />

      <CheckoutSteps
        current={step}
        onStep={(next) => {
          // Only allow going back via the step bar — forward needs validated Continue.
          if (next < step && !stripePay) {
            setError("");
            setStep(next);
          }
        }}
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:gap-8">
        <div className="min-w-0 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-ink">Customer information</h2>
              <FormError message={fe.formError} />
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="co-name">
                  Full name <span className="text-red-600">*</span>
                </label>
                <input
                  id="co-name"
                  className={fe.get("fullName") ? inputErrCls : inputCls}
                  placeholder="Full name"
                  autoComplete="name"
                  aria-invalid={fe.has("fullName")}
                  value={form.fullName}
                  onChange={(e) => {
                    setForm({ ...form, fullName: e.target.value });
                    fe.clear("fullName");
                  }}
                />
                <FieldError message={fe.get("fullName")} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="co-phone">
                  Mobile number <span className="text-red-600">*</span>
                </label>
                <input
                  id="co-phone"
                  className={fe.get("phone") ? inputErrCls : inputCls}
                  placeholder="03XXXXXXXXX"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={16}
                  aria-invalid={fe.has("phone")}
                  value={form.phone}
                  onChange={(e) => {
                    setForm({ ...form, phone: e.target.value });
                    fe.clear("phone");
                  }}
                />
                <FieldError message={fe.get("phone")} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="co-email">
                  Email (optional)
                </label>
                <input
                  id="co-email"
                  className={fe.get("email") ? inputErrCls : inputCls}
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={fe.has("email")}
                  value={form.email}
                  onChange={(e) => {
                    setForm({ ...form, email: e.target.value });
                    fe.clear("email");
                  }}
                />
                <FieldError message={fe.get("email")} />
              </div>
              <Button onClick={goToStep2}>Continue</Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-ink">
                Delivery address <span className="text-red-600">*</span>
              </h2>
              <p className="text-sm text-ink-subtle">
                Address is required. Delivery charges update for each address
                (distance-based when map pins are available).
              </p>
              <DeliveryEtaNote />
              {addresses.length > 0 && (
                <div className="space-y-2">
                  {addresses.map((a) => {
                    const quote = quoteByAddress.get(a.id);
                    const selected = !useNewAddress && addressId === a.id;
                    return (
                      <label
                        key={a.id}
                        className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${
                          selected
                            ? "border-brand-600 bg-brand-50"
                            : "border-line"
                        }`}
                      >
                        <input
                          type="radio"
                          name="checkout-address"
                          checked={selected}
                          onChange={() => {
                            setAddressId(a.id);
                            setUseNewAddress(false);
                            setError("");
                            void loadCart({ addressId: a.id, withQuotes: true });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="font-medium">
                              {a.label} — {a.fullName}
                            </p>
                            <p
                              className={`shrink-0 text-sm font-bold ${
                                quote?.isFree || quote?.deliveryFee === 0
                                  ? "text-emerald-600"
                                  : "text-brand-700"
                              }`}
                            >
                              {quote
                                ? quote.isFree || quote.deliveryFee === 0
                                  ? "FREE delivery"
                                  : formatCurrency(quote.deliveryFee)
                                : "…"}
                            </p>
                          </div>
                          <p className="break-words text-sm text-ink-subtle">
                            {a.houseBuilding}, {a.area}, {a.city}
                          </p>
                          {quote?.reason && (
                            <p className="mt-1 text-xs text-ink-subtle">
                              {quote.reason}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-600"
                    onClick={() => {
                      setUseNewAddress(true);
                      setAddressId("");
                      setError("");
                      void loadCart({
                        addressId: "",
                        city: form.city,
                        area: form.area,
                        withQuotes: true,
                      });
                    }}
                  >
                    + Use a new address
                  </button>
                </div>
              )}

              {(useNewAddress || addresses.length === 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["label", "Label (Home/Office)", true],
                      ["houseBuilding", "House / building", true],
                      ["street", "Street", false],
                      ["area", "Area", true],
                      ["postalCode", "Postal code (5 digits)", false],
                      ["nearbyLandmark", "Nearby landmark", false],
                    ] as const
                  ).map(([key, placeholder, required]) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs font-semibold text-ink-muted">
                        {placeholder}
                        {required && <span className="text-red-600"> *</span>}
                      </label>
                      <input
                        className={fe.get(key) ? inputErrCls : inputCls}
                        placeholder={placeholder}
                        required={required}
                        aria-invalid={fe.has(key)}
                        value={form[key]}
                        onChange={(e) => {
                          const next = { ...form, [key]: e.target.value };
                          setForm(next);
                          fe.clear(key);
                          if (key === "area") {
                            void loadCart({
                              addressId: "",
                              city: next.city,
                              area: e.target.value,
                              withQuotes: true,
                            });
                          }
                        }}
                      />
                      <FieldError message={fe.get(key)} />
                    </div>
                  ))}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="co-city">
                      City<span className="text-red-600"> *</span>
                    </label>
                    <select
                      id="co-city"
                      className={fe.get("city") ? inputErrCls : inputCls}
                      aria-invalid={fe.has("city")}
                      value={form.city}
                      onChange={(e) => {
                        setForm({ ...form, city: e.target.value });
                        fe.clear("city");
                        void loadCart({ addressId: "", city: e.target.value, area: form.area, withQuotes: true });
                      }}
                    >
                      {!(PK_CITIES as readonly string[]).includes(form.city) && (
                        <option value="">Choose a city</option>
                      )}
                      {PK_CITIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <FieldError message={fe.get("city")} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="co-province">
                      Province<span className="text-red-600"> *</span>
                    </label>
                    <select
                      id="co-province"
                      className={fe.get("province") ? inputErrCls : inputCls}
                      aria-invalid={fe.has("province")}
                      value={form.province}
                      onChange={(e) => {
                        setForm({ ...form, province: e.target.value });
                        fe.clear("province");
                      }}
                    >
                      {!(PK_PROVINCES as readonly string[]).includes(form.province) && (
                        <option value="">Choose a province</option>
                      )}
                      {PK_PROVINCES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <FieldError message={fe.get("province")} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-ink-muted">
                      Delivery instructions
                    </label>
                    <textarea
                      className={fe.get("deliveryInstructions") ? inputErrCls : inputCls}
                      placeholder="Delivery instructions"
                      maxLength={500}
                      value={form.deliveryInstructions}
                      onChange={(e) => {
                        setForm({ ...form, deliveryInstructions: e.target.value });
                        fe.clear("deliveryInstructions");
                      }}
                    />
                    <FieldError message={fe.get("deliveryInstructions")} />
                  </div>
                  <div className="sm:col-span-2 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm dark:border-brand-500/20 dark:bg-brand-500/10">
                    <div className="flex justify-between font-semibold">
                      <span>Delivery{summary.deliveryBid ? "" : " (standard)"}</span>
                      <span className={summary.deliveryFee === 0 && !summary.deliveryBid ? "text-emerald-600" : "text-brand-700 dark:text-brand-300"}>
                        {summary.deliveryBid
                          ? formatCurrency(summary.deliveryBid.fee)
                          : summary.deliveryFee === 0
                            ? "FREE"
                            : formatCurrency(summary.deliveryFee)}
                      </span>
                    </div>
                    {summary.deliveryReason && !summary.deliveryBid && (
                      <p className="mt-1 text-xs text-ink-subtle">{summary.deliveryReason}</p>
                    )}
                    {summary.deliveryBid ? (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <span>✓ Rider chosen — delivery {formatCurrency(summary.deliveryBid.fee)}.</span>
                        <a href="/checkout/riders" className="shrink-0 font-bold underline">Change</a>
                      </div>
                    ) : summary.deliveryFee > 0 ? (
                      <>
                        <a
                          href="/checkout/riders"
                          className="press mt-3 flex items-center justify-between gap-2 rounded-xl bg-brand-600 px-3.5 py-2.5 text-xs font-bold text-white transition hover:bg-brand-700"
                        >
                          <span className="flex items-center gap-2">
                            🏍️ Let riders bid — may be cheaper
                            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide">
                              Bidding
                            </span>
                          </span>
                          <span aria-hidden>→</span>
                        </a>
                        <p className="mt-1.5 text-[11px] text-ink-subtle">
                          No rider online? You&apos;ll continue at the standard fee — the store prepares your order and a rider is assigned once available.
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={goToStep3}>Continue</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-ink">Order summary</h2>
              <ul className="divide-y divide-surface-border">
                {summary.items.map((item, i) => (
                  <li key={i} className="flex justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0 break-words">
                      {item.name} × {item.quantity}
                    </span>
                    <span className="shrink-0">{formatCurrency(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <span>Products</span>
                  <span>{formatCurrency(summary.subtotal)}</span>
                </div>
                {summary.discount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Coupon discount</span>
                    <span>-{formatCurrency(summary.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span>Delivery fee</span>
                  <span
                    className={
                      summary.deliveryFee === 0 ? "text-emerald-600" : undefined
                    }
                  >
                    {summary.deliveryFee === 0
                      ? "FREE"
                      : formatCurrency(summary.deliveryFee)}
                  </span>
                </div>
                {summary.deliveryFee > 0 &&
                  summary.freeDeliveryThreshold > 0 &&
                  summary.freeDeliveryShortBy > 0 && (
                    <p className="text-xs text-brand-700">
                      Free delivery on Rs {summary.freeDeliveryThreshold.toLocaleString("en-PK")}+
                      of products — add {formatCurrency(summary.freeDeliveryShortBy)} more
                    </p>
                  )}
                {summary.deliveryReason && (
                  <p
                    className={`text-xs ${summary.deliveryFee === 0 ? "text-emerald-700" : "text-ink-subtle"}`}
                  >
                    {summary.deliveryReason}
                  </p>
                )}
                <div className="flex justify-between text-base font-semibold">
                  <span>Grand total</span>
                  <span>{formatCurrency(summary.total)}</span>
                </div>
              </div>
              <CouponBox
                value={couponInput}
                onChange={setCouponInput}
                onApply={() => void applyCoupon()}
                onRemove={() => void removeCoupon()}
                state={summary.coupon}
                busy={couponBusy}
              />
              <textarea
                className={inputCls}
                placeholder="Order notes"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={() => void goToStep4()}>Continue to payment</Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-ink">Payment</h2>
              <p className="rounded-xl bg-app px-4 py-3 text-sm font-medium text-ink-muted">
                {fullCodEligible
                  ? "Products: cash to rider or online · Delivery fee: online, or in cash with full cash on delivery"
                  : "Products: cash to rider or online · Delivery fee: paid online"}
                {summary.fullCod?.message && summary.deliveryFee > 0 && (
                  <span className="mt-1 block text-xs font-normal text-ink-subtle">
                    {summary.fullCod.message}
                    {fullCodEligible ? " — your order qualifies." : "."}
                  </span>
                )}
              </p>

              {needsOnline && !onlinePayAvailable && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  Online payment is not available right now. Please try again
                  later or contact MandiBazaar support.
                </div>
              )}

              {stripePay ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200">
                    Order <strong>{stripePay.orderNumber}</strong> created. Enter
                    your card details below to pay{" "}
                    <strong>{formatCurrency(stripePay.amountPkr)}</strong>.
                  </div>
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
                    onError={(message) => setError(message)}
                  />
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-line p-4">
                    <p className="mb-3 text-sm font-semibold">Products ({formatCurrency(summary.productTotal)})</p>
                    <label className="mb-2 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
                      <input
                        type="radio"
                        name="product-payment"
                        checked={productPaymentChoice === "CASH_ON_DELIVERY"}
                        onChange={() => choosePayment("CASH_ON_DELIVERY")}
                      />
                      <div>
                        <p className="font-medium">
                          {fullCodEligible ? "Pay products in cash to rider" : "Pay cash to rider"}
                        </p>
                        <p className="text-xs text-ink-subtle">
                          Pay {formatCurrency(summary.productTotal)} in cash when your order arrives.
                          {summary.deliveryFee > 0 ? (
                            <span className="font-semibold text-accent-600">
                              {" "}
                              The {formatCurrency(summary.deliveryFee)} delivery fee is paid online now.
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </label>
                    {fullCodEligible && (
                      <label className="mb-2 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
                        <input
                          type="radio"
                          name="product-payment"
                          checked={productPaymentChoice === "FULL_COD"}
                          onChange={() => choosePayment("FULL_COD")}
                        />
                        <div>
                          <p className="font-medium">
                            Pay everything in cash to the rider (products + delivery fee)
                          </p>
                          <p className="text-xs text-ink-subtle">
                            Pay {formatCurrency(summary.productTotal + summary.deliveryFee)} in cash
                            when your order arrives — nothing to pay online.
                          </p>
                        </div>
                      </label>
                    )}
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
                      <input
                        type="radio"
                        name="product-payment"
                        checked={productPaymentChoice === "ONLINE"}
                        onChange={() => choosePayment("ONLINE")}
                      />
                      <div>
                        <p className="font-medium">Pay products online now</p>
                        <p className="text-xs text-ink-subtle">
                          Pay {formatCurrency(summary.productTotal)} online now
                          {summary.deliveryFee > 0 ? ", together with the delivery fee" : ""}.
                        </p>
                      </div>
                    </label>
                  </div>

                  <div className="rounded-xl border border-accent-500/30 bg-accent-50 p-4 dark:border-accent-500/25 dark:bg-accent-500/10">
                    <p className="text-xs font-bold uppercase tracking-wide text-accent-600 dark:text-accent-400">
                      Delivery fee
                    </p>
                    <p className="text-xl font-semibold text-ink">
                      {summary.deliveryFee === 0
                        ? "FREE"
                        : formatCurrency(summary.deliveryFee)}
                    </p>
                    <p className="mt-2 text-sm font-medium text-ink">
                      {summary.deliveryFee <= 0
                        ? "No delivery fee on this order."
                        : fullCodChosen
                          ? "Paid in cash to the rider together with your products."
                          : fullCodEligible
                            ? "Paid online now — or choose \"Pay everything in cash\" above."
                            : "Paid online now — cash on delivery is not available for the delivery fee on this order."}
                    </p>
                    {summary.deliveryFee > 0 && summary.deliveryReason && (
                      <p className="mt-1 text-xs text-ink-subtle">
                        {summary.deliveryReason}
                      </p>
                    )}
                    <DeliveryEtaNote className="mt-3 border-accent-200/60 bg-card/70 dark:border-accent-500/20" compact />
                  </div>

                  {needsOnline &&
                    (payConfig.stripeEnabled || payConfig.jazzcashQrEnabled) && (
                      <div className="rounded-xl border border-line p-4">
                        <p className="mb-1 text-sm font-semibold">
                          Pay {formatCurrency(onlineAmount)} online with
                        </p>
                        {!payProductsOnline && summary.deliveryFee > 0 ? (
                          <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                            This is <strong>only the {formatCurrency(summary.deliveryFee)} delivery fee</strong>.
                            Your {formatCurrency(summary.productTotal)} of products are paid in{" "}
                            <strong>cash to the rider</strong> on arrival.
                          </p>
                        ) : (
                          <p className="mb-3 text-xs text-ink-subtle">
                            {payProductsOnline && summary.deliveryFee > 0
                              ? "Delivery fee + products"
                              : "Products"}
                          </p>
                        )}
                        {payConfig.stripeEnabled && (
                          <label
                            className={`mb-2 flex items-start gap-3 rounded-xl border p-3 ${
                              cardAllowed
                                ? "cursor-pointer border-line"
                                : "cursor-not-allowed border-line bg-app opacity-70"
                            }`}
                          >
                            <input
                              type="radio"
                              name="online-provider"
                              disabled={!cardAllowed}
                              checked={effectiveProvider === "STRIPE" && cardAllowed}
                              onChange={() => chooseProvider("STRIPE")}
                            />
                            <div>
                              <p className="font-medium">Debit / credit card</p>
                              <p className="text-xs text-ink-subtle">
                                {cardAllowed
                                  ? "Pay instantly with your card"
                                  : cardNote}
                              </p>
                            </div>
                          </label>
                        )}
                        {payConfig.jazzcashQrEnabled && (
                          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
                            <input
                              type="radio"
                              name="online-provider"
                              checked={effectiveProvider === "JAZZCASH_QR"}
                              onChange={() => chooseProvider("JAZZCASH_QR")}
                            />
                            <div>
                              <p className="font-medium">JazzCash QR / Till</p>
                              <p className="text-xs text-ink-subtle">
                                Scan QR or use Till ID, then upload payment receipt
                              </p>
                            </div>
                          </label>
                        )}
                      </div>
                    )}

                  {cardBlocked && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
                      {cardNote}
                    </p>
                  )}

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setStep(3)} disabled={processing}>
                      Back
                    </Button>
                    <Button
                      onClick={placeOrder}
                      disabled={processing || (needsOnline && !onlinePayAvailable) || cardBlocked}
                    >
                      {processing
                        ? "Preparing payment..."
                        : needsOnline
                          ? !onlinePayAvailable
                            ? "Payment unavailable"
                            : effectiveProvider === "JAZZCASH_QR"
                              ? "Continue to JazzCash QR"
                              : "Continue to card details"
                          : "Confirm order"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="h-fit rounded-2xl bg-brand-950 p-5 text-white lg:sticky lg:top-36">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Payable now</p>
          <p className="mt-1 text-3xl font-extrabold">{formatCurrency(onlineAmount)}</p>
          <p className="mt-3 text-sm text-emerald-100">
            Delivery:{" "}
            {summary.deliveryFee === 0
              ? "FREE"
              : formatCurrency(summary.deliveryFee)}
          </p>
          {summary.discount > 0 && (
            <p className="mt-2 text-sm text-emerald-100">
              Coupon: -{formatCurrency(summary.discount)}
            </p>
          )}
          <p className="mt-2 text-sm text-emerald-200">
            Cash to rider: {formatCurrency(cashToRider)}
            {fullCodChosen ? " (products + delivery)" : ""}
          </p>
        </aside>
      </div>
    </ShopContainer>
  );
}
