"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { Pagination } from "@/components/ui/Pagination";
import { Search } from "lucide-react";

type Addr = {
  fullName?: string;
  phone?: string;
  houseBuilding?: string;
  street?: string;
  area?: string;
  city?: string;
};

type Proof = {
  id: string;
  imageUrl: string;
  status: string;
  createdAt: string;
  reviewNotes: string | null;
};

type Order = {
  id: string;
  orderNumber: string;
  orderStatus: string;
  remainingAmount: number;
  /** Cash to collect: products + delivery fee for full cash-on-delivery orders */
  cashDue?: { products: number; delivery: number; total: number };
  productPaymentStatus: string;
  paymentMethod: string;
  deliveryAddressSnapshot: Addr | null;
  customer: { fullName: string; phone: string } | null;
  fulfillments: {
    store: { name: string; phone: string | null } | null;
    pickupAddress: { name?: string; addressLine?: string; city?: string } | null;
  }[];
  cashCollection: { amountCollected: unknown } | null;
  cashRemittance: { status: string; amount: unknown } | null;
  paymentProofs: Proof[];
  items: { productName: string; quantity: number; storeName: string }[];
};

export default function RiderDeliveriesPage() {
  const [items, setItems] = useState<Order[]>([]);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState("");
  const [failReason, setFailReason] = useState<Record<string, string>>({});
  const [proofUrl, setProofUrl] = useState<Record<string, string>>({});
  /** QA S16: proof upload error shown under the upload field */
  const [proofErr, setProofErr] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  async function load() {
    const params = new URLSearchParams({ resource: "deliveries", page: String(page), limit: "20" });
    if (filter) params.set("status", filter);
    if (q) params.set("q", q);
    const res = await fetch(`/api/rider?${params}`, { cache: "no-store" });
    const json = await res.json();
    if (json.success) {
      setItems(json.data.items);
      setTotal(json.data.pagination?.total ?? json.data.items.length);
      setTotalPages(json.data.pagination?.totalPages ?? 1);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page, q]);

  async function act(
    orderId: string,
    action: string,
    extra?: Record<string, unknown>
  ) {
    setBusyId(orderId);
    setMsg("");
    const res = await fetch("/api/rider", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, orderId, ...extra }),
    });
    const json = await res.json();
    setBusyId("");
    if (!json.success) {
      if (action === "UPLOAD_PAYMENT_PROOF") {
        setProofErr((prev) => ({
          ...prev,
          [orderId]: json.fieldErrors?.imageUrl || json.error || "Upload failed",
        }));
        return;
      }
      setMsg(json.error || "Action failed");
      return;
    }
    if (action === "UPLOAD_PAYMENT_PROOF") setProofErr((prev) => ({ ...prev, [orderId]: "" }));
    setMsg(json.data?.message || "Updated");
    if (action === "UPLOAD_PAYMENT_PROOF") {
      setProofUrl((prev) => ({ ...prev, [orderId]: "" }));
    }
    load();
  }

  function formatAddr(a: Addr | null) {
    if (!a) return "—";
    return [a.fullName, a.phone, a.houseBuilding, a.street, a.area, a.city]
      .filter(Boolean)
      .join(", ");
  }

  /** "Rs 650 cash (products Rs 500 + delivery Rs 150)" */
  function cashText(o: Order) {
    const d = o.cashDue;
    if (d && d.delivery > 0) {
      return `${formatCurrency(o.remainingAmount)} cash (products ${formatCurrency(d.products)} + delivery ${formatCurrency(d.delivery)})`;
    }
    return `${formatCurrency(o.remainingAmount)} cash`;
  }

  function needsOnlineProof(o: Order) {
    return (
      o.remainingAmount <= 0 &&
      !o.cashCollection &&
      (o.productPaymentStatus === "PAID" || o.paymentMethod === "JAZZCASH")
    );
  }

  function hasApprovedProof(o: Order) {
    return (o.paymentProofs || []).some((p) => p.status === "APPROVED");
  }

  function hasPendingProof(o: Order) {
    return (o.paymentProofs || []).some((p) => p.status === "PENDING_REVIEW");
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-ink">Deliveries</h1>
      <div className="mt-2 space-y-1 rounded-xl border border-line bg-card p-3 text-sm text-ink-muted">
        <p>
          <strong>Cash order (COD):</strong> collect the exact amount shown on the
          order from the customer, then submit that cash to MandiBazaar.
        </p>
        <p>
          <strong>Already paid online:</strong> don&apos;t collect any money. Ask the
          customer to show the payment message on their phone, take a photo or
          screenshot of it and upload it here. MandiBazaar checks it, then you
          can mark the order delivered.
        </p>
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(qInput.trim());
        }}
      >
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400"
            placeholder="Order number, e.g. ORD-2026…"
            maxLength={30}
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              if (!e.target.value) {
                setQ("");
                setPage(1);
              }
            }}
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { v: "", l: "All" },
          { v: "ASSIGNED_TO_RIDER", l: "Assigned" },
          { v: "OUT_FOR_DELIVERY", l: "Out for delivery" },
          { v: "DELIVERED", l: "Delivered" },
          { v: "FAILED", l: "Failed" },
        ].map((f) => (
          <button
            key={f.v || "all"}
            type="button"
            onClick={() => {
              setFilter(f.v);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === f.v
                ? "bg-emerald-600 text-white"
                : "bg-card text-ink-muted ring-1 ring-line"
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {msg && (
        <p className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {msg}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {items.length === 0 && (
          <p className="text-sm text-ink-subtle">{q ? "No delivery matches this order number." : "No deliveries in this filter."}</p>
        )}
        {items.map((o) => {
          const needsCod =
            o.remainingAmount > 0 &&
            !o.cashCollection &&
            ["OUT_FOR_DELIVERY", "DELIVERED", "ASSIGNED_TO_RIDER"].includes(
              o.orderStatus
            );
          const online = needsOnlineProof(o);
          const proofOk = hasApprovedProof(o);
          const proofPending = hasPendingProof(o);
          const latestProof = o.paymentProofs?.[0];

          return (
            <div
              key={o.id}
              className="rounded-2xl border border-line bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold text-ink">{o.orderNumber}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    {o.orderStatus.replace(/_/g, " ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {needsCod && (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                      Collect {cashText(o)}
                    </span>
                  )}
                  {online && (
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">
                      Paid online — don&apos;t collect money
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 text-sm text-ink-muted md:grid-cols-2">
                <div>
                  <p className="font-semibold text-ink">Drop-off</p>
                  <p>{formatAddr(o.deliveryAddressSnapshot)}</p>
                  <p className="text-xs text-ink-subtle">
                    Customer: {o.customer?.fullName} · {o.customer?.phone}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-ink">Pickups</p>
                  <ul className="list-inside list-disc text-xs">
                    {o.fulfillments.map((f, i) => {
                      const p = f.pickupAddress;
                      return (
                        <li key={i}>
                          {f.store?.name || p?.name || "Store"} —{" "}
                          {p?.addressLine || ""} {p?.city || ""}{" "}
                          {f.store?.phone ? `· ${f.store.phone}` : ""}
                        </li>
                      );
                    })}
                    {o.fulfillments.length === 0 &&
                      Array.from(new Set(o.items.map((i) => i.storeName))).map(
                        (n) => <li key={n}>{n}</li>
                      )}
                  </ul>
                </div>
              </div>

              <p className="mt-2 text-xs text-ink-subtle">
                Items:{" "}
                {o.items
                  .map((i) => `${i.productName} ×${i.quantity}`)
                  .join(", ")}
              </p>

              {o.cashRemittance && (
                <p className="mt-2 text-xs font-medium text-ink-muted">
                  Remittance: {o.cashRemittance.status} ·{" "}
                  {formatCurrency(Number(o.cashRemittance.amount))}
                </p>
              )}

              {online &&
                ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY", "DELIVERED"].includes(
                  o.orderStatus
                ) && (
                  <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-4">
                    <p className="text-sm font-semibold text-sky-900">
                      Proof of online payment
                    </p>
                    <p className="mt-1 text-xs text-sky-700">
                      This customer already paid online, so don&apos;t take any cash.
                      Ask them to open the payment message (JazzCash, bank or card)
                      on their phone. Take a clear photo or screenshot that shows the
                      amount and date, and upload it below. MandiBazaar checks it —
                      then you can mark the order delivered.
                    </p>

                    {latestProof && (
                      <div className="mt-3 flex flex-wrap items-start gap-3">
                        <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-sky-200 bg-card">
                          <Image
                            src={latestProof.imageUrl}
                            alt="Payment proof"
                            fill
                            className="object-cover"
                            sizes="96px"
                            unoptimized
                          />
                        </div>
                        <div className="text-xs">
                          <p className="font-bold uppercase text-sky-800">
                            {latestProof.status.replace(/_/g, " ")}
                          </p>
                          {latestProof.status === "REJECTED" && (
                            <p className="mt-1 text-red-600">
                              Rejected
                              {latestProof.reviewNotes
                                ? `: ${latestProof.reviewNotes}`
                                : ""}{" "}
                              — please re-upload
                            </p>
                          )}
                          {latestProof.status === "APPROVED" && (
                            <p className="mt-1 text-emerald-700 dark:text-emerald-300">
                              Approved by MandiBazaar
                            </p>
                          )}
                          {latestProof.status === "PENDING_REVIEW" && (
                            <p className="mt-1 text-sky-700">
                              Waiting for MandiBazaar review
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {((!proofOk && !proofPending) ||
                      latestProof?.status === "REJECTED") && (
                      <div className="mt-3 space-y-3">
                        <ImageUploadField
                          label="Upload payment screenshot"
                          value={proofUrl[o.id] || ""}
                          onChange={(url) => {
                            setProofUrl((prev) => ({ ...prev, [o.id]: url }));
                            setProofErr((prev) => ({ ...prev, [o.id]: "" }));
                          }}
                          folder="payment-proofs"
                          required
                          hint="JPG/PNG from customer phone — max 5MB"
                        />
                        {proofErr[o.id] && (
                          <p className="text-xs text-red-600" role="alert">
                            {proofErr[o.id]}
                          </p>
                        )}
                        <Button
                          disabled={busyId === o.id || !proofUrl[o.id]}
                          onClick={() =>
                            act(o.id, "UPLOAD_PAYMENT_PROOF", {
                              imageUrl: proofUrl[o.id],
                            })
                          }
                        >
                          Send proof to MandiBazaar
                        </Button>
                      </div>
                    )}
                  </div>
                )}

              <div className="mt-4 flex flex-wrap gap-2">
                {o.orderStatus === "ASSIGNED_TO_RIDER" && (
                  <Button
                    disabled={busyId === o.id}
                    onClick={() => act(o.id, "START_DELIVERY")}
                  >
                    Picked up — start delivery
                  </Button>
                )}
                {o.orderStatus === "OUT_FOR_DELIVERY" && (
                  <>
                    <Button
                      disabled={
                        busyId === o.id || (online && !proofOk)
                      }
                      onClick={() =>
                        act(o.id, "MARK_DELIVERED", {
                          amountCollected: needsCod
                            ? o.remainingAmount
                            : undefined,
                        })
                      }
                    >
                      {needsCod
                        ? `Collected ${cashText(o)} — mark delivered`
                        : online && proofPending
                          ? "Waiting for MandiBazaar approval"
                          : online && !proofOk
                          ? "Upload payment screenshot first"
                          : "Mark delivered"}
                    </Button>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="rounded-xl border border-line px-3 py-2 text-sm"
                        placeholder="Fail reason"
                        value={failReason[o.id] || ""}
                        onChange={(e) =>
                          setFailReason({
                            ...failReason,
                            [o.id]: e.target.value,
                          })
                        }
                      />
                      <Button
                        variant="outline"
                        disabled={busyId === o.id}
                        onClick={() =>
                          act(o.id, "MARK_FAILED", {
                            failureReason: failReason[o.id],
                          })
                        }
                      >
                        Mark failed
                      </Button>
                    </div>
                  </>
                )}
                {o.orderStatus === "DELIVERED" &&
                  needsCod &&
                  !o.cashCollection && (
                    <Button
                      disabled={busyId === o.id}
                      onClick={() =>
                        act(o.id, "COLLECT_CASH", {
                          amountCollected: o.remainingAmount,
                        })
                      }
                    >
                      Collect {cashText(o)}
                    </Button>
                  )}
              </div>
            </div>
          );
        })}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={20}
        onPageChange={(n) => {
          setPage(n);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        itemLabel="deliveries"
      />
    </div>
  );
}
