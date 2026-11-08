"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/Pagination";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import {
  COUPON_FIXED_MIN_ORDER_MULTIPLIER,
  COUPON_MAX_PERCENT,
  couponDefinitionSchema,
  describeCouponValue,
  rs,
  toPkYmd,
} from "@/lib/orders/coupon-rules";

type CouponRow = {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minimumOrderAmount: number | null;
  maximumDiscount: number | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  startDate: string;
  expiryDate: string;
  isActive: boolean;
  usedCount: number;
  totalDiscountGiven: number;
  problems: string[];
  expired: boolean;
};

type FormState = {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  minimumOrderAmount: string;
  maximumDiscount: string;
  usageLimit: string;
  perUserLimit: string;
  firstOrderOnly: boolean;
  startDate: string;
  expiryDate: string;
  isActive: boolean;
};

const PAGE_SIZE = 25;

function emptyForm(): FormState {
  const today = toPkYmd(new Date());
  const inAMonth = toPkYmd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  // Nothing hidden: every rule is visible and chosen by the admin (QA T1)
  return {
    code: "",
    type: "PERCENTAGE",
    value: "",
    minimumOrderAmount: "",
    maximumDiscount: "",
    usageLimit: "",
    perUserLimit: "1",
    firstOrderOnly: false,
    startDate: today,
    expiryDate: inAMonth,
    isActive: true,
  };
}

function formFrom(c: CouponRow): FormState {
  return {
    code: c.code,
    type: c.type,
    value: String(c.value),
    minimumOrderAmount: c.minimumOrderAmount != null ? String(c.minimumOrderAmount) : "",
    maximumDiscount: c.maximumDiscount != null ? String(c.maximumDiscount) : "",
    usageLimit: c.usageLimit != null ? String(c.usageLimit) : "",
    perUserLimit: c.perUserLimit != null ? String(c.perUserLimit) : "",
    firstOrderOnly: c.firstOrderOnly,
    startDate: toPkYmd(c.startDate),
    expiryDate: toPkYmd(c.expiryDate),
    isActive: c.isActive,
  };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });
}

export default function AdminCouponsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const fe = useFieldErrors();
  const [items, setItems] = useState<CouponRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/coupons?page=${p}&limit=${PAGE_SIZE}`);
      const d = await res.json();
      if (d.success) {
        setItems(d.data.items);
        setPages(d.data.pagination.totalPages);
        setTotal(d.data.pagination.total);
      } else {
        toast.error(d.error || "Could not load coupons");
      }
    } catch {
      toast.error("Could not load coupons");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load(page);
  }, [page, load]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    fe.clear(key as string);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    fe.clear();
    setShowForm(true);
  }

  function openEdit(c: CouponRow) {
    setEditing(c);
    setForm(formFrom(c));
    fe.clear();
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sameLegacyCode = editing && form.code.trim().toUpperCase() === editing.code.toUpperCase();
    const values = { ...form, code: sameLegacyCode ? "KEEPCODE" : form.code };
    if (!fe.check(couponDefinitionSchema, values)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, data: form } : { data: form }),
      });
      const d = await res.json();
      if (!d.success) {
        fe.fromResponse(d);
        return;
      }
      toast.success(editing ? `Coupon ${d.data.code} updated` : `Coupon ${d.data.code} created`);
      setShowForm(false);
      setEditing(null);
      void load(editing ? page : 1);
      if (!editing) setPage(1);
    } catch {
      fe.setFormError("Could not save the coupon. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: CouponRow) {
    const next = !c.isActive;
    if (!next) {
      const r = await confirm({
        title: `Deactivate ${c.code}?`,
        message: "Customers will no longer be able to use this coupon. You can activate it again later.",
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (!r.confirmed) return;
    }
    const res = await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, action: "TOGGLE", isActive: next }),
    });
    const d = await res.json();
    if (!d.success) {
      toast.error(d.error || "Could not change the coupon");
      return;
    }
    toast.success(`${c.code} ${next ? "activated" : "deactivated"}`);
    void load(page);
  }

  async function remove(c: CouponRow) {
    if (c.usedCount > 0) {
      toast.info(`${c.code} has been used ${c.usedCount} time(s) — deactivate it instead, so past orders keep their record.`);
      return;
    }
    const r = await confirm({
      title: `Delete ${c.code}?`,
      message: "This coupon has never been used. Deleting it cannot be undone.",
      confirmLabel: "Delete coupon",
      tone: "danger",
    });
    if (!r.confirmed) return;
    const res = await fetch(`/api/admin/coupons?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    const d = await res.json();
    if (!d.success) {
      toast.error(d.error || "Could not delete the coupon");
      return;
    }
    toast.success(`${c.code} deleted`);
    void load(page);
  }

  const valueNum = Number(form.value);
  const fixedNeeded =
    form.type === "FIXED" && valueNum > 0 ? valueNum * COUPON_FIXED_MIN_ORDER_MULTIPLIER : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Coupons</h1>
        {!showForm && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white"
          >
            New coupon
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={save} noValidate className="mt-6 space-y-4 rounded-3xl bg-card p-4 shadow-card sm:p-6">
          <h2 className="text-lg font-semibold">{editing ? `Edit ${editing.code}` : "New coupon"}</h2>
          <FormError message={fe.formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-code">Code *</label>
              <input
                id="c-code"
                className={inputClass(fe.has("code"))}
                value={form.code}
                maxLength={20}
                placeholder="e.g. SAVE10"
                disabled={Boolean(editing && editing.usedCount > 0)}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                3–20 capital letters or numbers, unique.
                {editing && editing.usedCount > 0 ? " Can't be changed after the coupon was used." : ""}
              </p>
              <FieldError message={fe.get("code")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-type">Type *</label>
              <select
                id="c-type"
                className={inputClass(fe.has("type"))}
                value={form.type}
                onChange={(e) => set("type", e.target.value as FormState["type"])}
              >
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED">Fixed amount (Rs)</option>
              </select>
              <FieldError message={fe.get("type")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-value">
                {form.type === "PERCENTAGE" ? "Discount (%) *" : "Discount (Rs) *"}
              </label>
              <input
                id="c-value"
                type="number"
                inputMode="numeric"
                min={1}
                max={form.type === "PERCENTAGE" ? COUPON_MAX_PERCENT : undefined}
                className={inputClass(fe.has("value"))}
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                {form.type === "PERCENTAGE"
                  ? `Whole number from 1 to ${COUPON_MAX_PERCENT}%.`
                  : "At least Rs 1. The minimum order must be at least 2× this amount."}
              </p>
              <FieldError message={fe.get("value")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-max">
                Maximum discount (Rs){form.type === "PERCENTAGE" ? " *" : ""}
              </label>
              <input
                id="c-max"
                type="number"
                inputMode="numeric"
                min={1}
                className={inputClass(fe.has("maximumDiscount"))}
                value={form.maximumDiscount}
                placeholder={form.type === "PERCENTAGE" ? "e.g. 500" : "Not needed for fixed"}
                onChange={(e) => set("maximumDiscount", e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                Required for percentage coupons, e.g. “10% off, up to Rs 500”.
              </p>
              <FieldError message={fe.get("maximumDiscount")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-min">
                Minimum order (Rs, products only){form.type === "FIXED" ? " *" : ""}
              </label>
              <input
                id="c-min"
                type="number"
                inputMode="numeric"
                min={0}
                className={inputClass(fe.has("minimumOrderAmount"))}
                value={form.minimumOrderAmount}
                placeholder={form.type === "FIXED" ? (fixedNeeded ? `At least ${fixedNeeded}` : "Required") : "Blank = no minimum"}
                onChange={(e) => set("minimumOrderAmount", e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                {fixedNeeded
                  ? `For ${rs(valueNum)} off, the minimum order must be at least ${rs(fixedNeeded)}.`
                  : "Customers see “Add Rs X more to use this coupon” until they reach it."}
              </p>
              <FieldError message={fe.get("minimumOrderAmount")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-total">Total usage limit</label>
              <input
                id="c-total"
                type="number"
                inputMode="numeric"
                min={1}
                className={inputClass(fe.has("usageLimit"))}
                value={form.usageLimit}
                placeholder="Blank = unlimited (e.g. 100)"
                onChange={(e) => set("usageLimit", e.target.value)}
              />
              <FieldError message={fe.get("usageLimit")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-per">Uses per customer</label>
              <input
                id="c-per"
                type="number"
                inputMode="numeric"
                min={1}
                className={inputClass(fe.has("perUserLimit"))}
                value={form.perUserLimit}
                placeholder="Blank = unlimited"
                onChange={(e) => set("perUserLimit", e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                Counted per account, per phone number and per delivery address.
              </p>
              <FieldError message={fe.get("perUserLimit")} />
            </div>
            <div className="flex flex-col justify-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.firstOrderOnly}
                  onChange={(e) => set("firstOrderOnly", e.target.checked)}
                />
                First order only (customers with no previous order)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set("isActive", e.target.checked)}
                />
                Active
              </label>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-start">Start date *</label>
              <input
                id="c-start"
                type="date"
                className={inputClass(fe.has("startDate"))}
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
              <FieldError message={fe.get("startDate")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted" htmlFor="c-end">Expiry date *</label>
              <input
                id="c-end"
                type="date"
                className={inputClass(fe.has("expiryDate"))}
                value={form.expiryDate}
                onChange={(e) => set("expiryDate", e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-subtle">The coupon works until the end of this day.</p>
              <FieldError message={fe.get("expiryDate")} />
            </div>
          </div>
          <p className="rounded-xl bg-app px-3 py-2 text-xs text-ink-muted">
            Coupons reduce products only, never the delivery fee, and can never take more than 90% off the
            products total.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create coupon"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
                fe.clear();
              }}
              className="rounded-full border px-5 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 space-y-3">
        {loading && !items.length ? (
          <div className="skeleton h-24 rounded-2xl" />
        ) : !items.length ? (
          <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-ink-subtle shadow-card">
            No coupons yet. Create one with “New coupon”.
          </p>
        ) : (
          items.map((c) => (
            <div key={c.id} className="rounded-2xl bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all font-semibold">
                    {c.code}{" "}
                    <span className="font-normal text-ink-muted">— {describeCouponValue(c)}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        c.isActive && !c.expired && !c.problems.length
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-ink-muted"
                      }`}
                    >
                      {!c.isActive ? "Inactive" : c.expired ? "Expired" : c.problems.length ? "Blocked" : "Active"}
                    </span>
                    {c.firstOrderOnly && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">First order only</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => openEdit(c)} className="rounded-full border px-3 py-1 text-xs font-semibold">
                    Edit
                  </button>
                  <button type="button" onClick={() => void toggle(c)} className="rounded-full border px-3 py-1 text-xs font-semibold">
                    {c.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(c)}
                    className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600"
                    title={c.usedCount > 0 ? "Used coupons can only be deactivated" : undefined}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted sm:grid-cols-4">
                <div><dt className="text-ink-subtle">Minimum order</dt><dd>{c.minimumOrderAmount ? rs(c.minimumOrderAmount) : "None"}</dd></div>
                <div><dt className="text-ink-subtle">Max discount</dt><dd>{c.maximumDiscount != null ? rs(c.maximumDiscount) : "—"}</dd></div>
                <div><dt className="text-ink-subtle">Total limit</dt><dd>{c.usageLimit ?? "Unlimited"}</dd></div>
                <div><dt className="text-ink-subtle">Per customer</dt><dd>{c.perUserLimit ?? "Unlimited"}</dd></div>
                <div><dt className="text-ink-subtle">Valid</dt><dd>{fmtDate(c.startDate)} – {fmtDate(c.expiryDate)}</dd></div>
                <div><dt className="text-ink-subtle">Used</dt><dd>{c.usedCount}{c.usageLimit ? ` of ${c.usageLimit}` : ""}</dd></div>
                <div><dt className="text-ink-subtle">Discount given</dt><dd>{rs(c.totalDiscountGiven)}</dd></div>
              </dl>
              {c.problems.length > 0 && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Customers can&apos;t use this coupon until it is fixed: {c.problems.join("; ")}. Click Edit to fix it.
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {pages > 1 && (
        <Pagination
          className="mt-6"
          page={page}
          totalPages={pages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          itemLabel="coupons"
        />
      )}
    </div>
  );
}
