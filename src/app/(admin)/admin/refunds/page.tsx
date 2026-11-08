"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { zOrderNumber, zText } from "@/lib/validators/pk";

const PAGE_SIZE = 25;

/** Same rules as POST /api/refunds (server re-checks, incl. amount ≤ paid − refunded). */
const refundFormSchema = z.object({
  orderNumber: zOrderNumber,
  reason: zText(500, "Reason", 3),
  amount: z.union([
    z.literal(""),
    z.coerce
      .number({ message: "Enter an amount in rupees" })
      .min(1, { message: "Refund amount must be at least Rs. 1" }),
  ]),
});

type Refund = {
  id: string;
  amount: number;
  reason: string;
  status: string;
  notes: string | null;
  createdAt: string;
  latePayment?: boolean;
  payment?: { method: string } | null;
  order: { orderNumber: string; orderStatus?: string };
  requestedBy: { fullName: string } | null;
};

const NEXT: Record<string, string[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["PROCESSING", "COMPLETED", "REJECTED"],
  PROCESSING: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
};

export default function AdminRefundsPage() {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const fe = useFieldErrors();
  const [items, setItems] = useState<Refund[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    orderKey: "",
    reason: "",
    amount: "",
    notes: "",
  });
  const [lookup, setLookup] = useState<{
    orderNumber: string;
    refundable: number;
    successPaid: number;
    payments: { method: string; amount: number; latePayment: boolean }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [extRef, setExtRef] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch(`/api/refunds?page=${page}&limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setItems(d.data.items || []);
          if (d.data.pagination) {
            setMeta({ total: d.data.pagination.total, totalPages: d.data.pagination.totalPages });
          }
        }
      });
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function lookupOrder() {
    setMsg("");
    setLookup(null);
    const parsed = zOrderNumber.safeParse(form.orderKey);
    if (!parsed.success) {
      fe.setErrors({ ...fe.errors, orderNumber: parsed.error.issues[0]?.message || "Order number looks like ORD-20261031-000001" });
      return;
    }
    fe.clear("orderNumber");
    const key = parsed.data;
    const res = await fetch(`/api/refunds?order=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (!data.success) {
      fe.setErrors({ ...fe.errors, orderNumber: data.error === "Order not found" ? "No order with this number" : data.error || "Order not found" });
      return;
    }
    setLookup({
      orderNumber: data.data.orderNumber,
      refundable: data.data.refundable,
      successPaid: data.data.successPaid,
      payments: data.data.payments || [],
    });
  }

  async function createRefund(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const values = {
      orderNumber: form.orderKey,
      reason: form.reason,
      amount: form.amount.trim(),
    };
    if (!fe.check(refundFormSchema, values)) return;
    const orderNumber = zOrderNumber.parse(form.orderKey);
    const amount = form.amount.trim() ? Number(form.amount) : undefined;
    if (lookup && lookup.orderNumber === orderNumber) {
      if (lookup.refundable <= 0) {
        fe.setErrors({ amount: "Nothing left to refund on this order" });
        return;
      }
      if (amount != null && amount > lookup.refundable) {
        fe.setErrors({ amount: `Refund cannot be more than ${formatCurrency(lookup.refundable)}` });
        return;
      }
    }
    const r = await confirmDialog({
      title: `Create a refund for ${orderNumber}?`,
      message: amount
        ? `Refund ${formatCurrency(amount)}.`
        : "Refund the full refundable amount.",
      confirmLabel: "Create refund",
    });
    if (!r.confirmed) return;
    setBusy(true);
    const res = await fetch("/api/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNumber,
        reason: form.reason.trim(),
        amount,
        notes: form.notes || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      fe.fromResponse(data);
      return;
    }
    fe.clear();
    toast.success("Refund created");
    setForm({ orderKey: "", reason: "", amount: "", notes: "" });
    setLookup(null);
    load();
  }

  async function advance(id: string, status: string, method?: string) {
    if (status === "COMPLETED" || status === "REJECTED") {
      const row = items.find((x) => x.id === id);
      const r = await confirmDialog({
        title: `Mark refund ${status === "COMPLETED" ? "completed" : "rejected"}?`,
        message:
          status === "COMPLETED"
            ? method === "STRIPE"
              ? `Stripe refunds ${formatCurrency(row?.amount || 0)} to the customer's card now.`
              : `Only after you have sent ${formatCurrency(row?.amount || 0)} back by JazzCash / bank.`
            : "The customer is told the refund was rejected.",
        confirmLabel: status === "COMPLETED" ? "Mark completed" : "Reject refund",
        tone: status === "REJECTED" ? "danger" : "default",
      });
      if (!r.confirmed) return;
    }
    setBusy(true);
    setMsg("");
    const needsRef =
      status === "COMPLETED" && method && method !== "STRIPE";
    const externalReference = extRef[id]?.trim();
    if (needsRef && !externalReference) {
      setBusy(false);
      setMsg("Enter JazzCash/bank refund reference before COMPLETED");
      return;
    }
    const res = await fetch("/api/refunds", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        status,
        ...(externalReference ? { externalReference } : {}),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setMsg(data.error || "Update failed");
      return;
    }
    setMsg(`Refund marked ${status}`);
    load();
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Refunds</h1>
      <p className="mt-2 text-sm text-ink-subtle">
        Stripe refunds run automatically on Completed. JazzCash/manual need an
        external reference before Completed. Cancelled paid orders and late
        payments auto-queue here.
      </p>
      {msg && (
        <p
          className={`mt-3 text-sm ${
            msg.toLowerCase().includes("fail") ||
            msg.toLowerCase().includes("enter") ||
            msg.toLowerCase().includes("not found")
              ? "text-red-600"
              : "text-leaf-600"
          }`}
        >
          {msg}
        </p>
      )}

      <form
        onSubmit={createRefund}
        className="mt-6 space-y-3 rounded-3xl bg-card p-5 shadow-card"
      >
        <h2 className="font-semibold text-ink">Create refund</h2>
        <div>
          <FieldLabel required>Order number</FieldLabel>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              className={inputClass(fe.has("orderNumber"), "min-w-[200px] flex-1 rounded-xl border px-3 py-2 text-sm")}
              placeholder="e.g. ORD-20261031-000001"
              value={form.orderKey}
              aria-invalid={fe.has("orderNumber")}
              onChange={(e) => {
                setForm({ ...form, orderKey: e.target.value });
                fe.clear("orderNumber");
              }}
            />
            <Button type="button" size="sm" variant="outline" onClick={lookupOrder}>
              Check refundable
            </Button>
          </div>
          <FieldError message={fe.get("orderNumber")} />
        </div>
        {lookup && (
          <div className="rounded-xl bg-brand-50 dark:bg-brand-500/10 px-3 py-2 text-xs text-ink">
            <p>
              {lookup.orderNumber}: paid online {formatCurrency(lookup.successPaid)} ·
              refundable {formatCurrency(lookup.refundable)}
            </p>
            {lookup.payments.map((p, i) => (
              <p key={i}>
                {p.method} {formatCurrency(p.amount)}
                {p.latePayment ? " · late payment on closed order" : ""}
              </p>
            ))}
          </div>
        )}
        <div>
          <FieldLabel>Amount in Rs. (optional — full refundable amount if empty)</FieldLabel>
          <input
            className={inputClass(fe.has("amount"), "mt-1 w-full rounded-xl border px-3 py-2 text-sm")}
            type="number"
            min="1"
            step="1"
            max={lookup ? lookup.refundable : undefined}
            inputMode="numeric"
            value={form.amount}
            onChange={(e) => {
              setForm({ ...form, amount: e.target.value });
              fe.clear("amount");
            }}
          />
          <FieldError message={fe.get("amount")} />
        </div>
        <div>
          <FieldLabel required>Reason</FieldLabel>
          <textarea
            className={inputClass(fe.has("reason"), "mt-1 w-full rounded-xl border px-3 py-2 text-sm")}
            rows={2}
            maxLength={500}
            value={form.reason}
            onChange={(e) => {
              setForm({ ...form, reason: e.target.value });
              fe.clear("reason");
            }}
          />
          <FieldError message={fe.get("reason")} />
        </div>
        <input
          className="w-full rounded-xl border px-3 py-2 text-sm"
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <FormError message={fe.formError} />
        <Button type="submit" size="sm" disabled={busy}>
          Create refund
        </Button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-brand-50 dark:bg-brand-500/10">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="px-4 py-3 font-medium">
                  {r.order?.orderNumber}
                  {r.latePayment && (
                    <span className="mt-1 block text-[10px] font-bold uppercase text-deal-600">
                      Late payment
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{formatCurrency(r.amount)}</td>
                <td className="px-4 py-3 text-xs">
                  {r.payment?.method || "—"}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-ink-muted">
                  {r.reason}
                </td>
                <td className="px-4 py-3">{r.status}</td>
                <td className="px-4 py-3">
                  {r.payment?.method &&
                    r.payment.method !== "STRIPE" &&
                    ["APPROVED", "PROCESSING"].includes(r.status) && (
                      <input
                        className="mb-2 w-full max-w-[180px] rounded-lg border px-2 py-1 text-[11px]"
                        placeholder="JazzCash/bank ref"
                        value={extRef[r.id] || ""}
                        onChange={(e) =>
                          setExtRef({ ...extRef, [r.id]: e.target.value })
                        }
                      />
                    )}
                  <div className="flex flex-wrap gap-1">
                    {(NEXT[r.status] || []).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          advance(r.id, s, r.payment?.method || undefined)
                        }
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold hover:bg-app"
                      >
                        {s}
                      </button>
                    ))}
                    {!NEXT[r.status]?.length && (
                      <span className="text-xs text-ink-subtle">Final</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-subtle">
                  No refunds yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        className="mt-3"
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        pageSize={PAGE_SIZE}
        itemLabel="refunds"
        onPageChange={setPage}
      />
    </div>
  );
}
