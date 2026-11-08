"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { stockAdjustLimitError, stockAdjustSchema } from "@/lib/admin/form-rules";

type Item = {
  id: string;
  name: string;
  sku: string;
  status: string;
  stockQuantity: number;
  availableStock: number;
  reservedStock: number;
  lowStockThreshold?: number;
  store?: { name: string };
};

const PAGE_SIZE = 25;

export default function AdminInventoryPage() {
  const toast = useToast();
  const fe = useFieldErrors();
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjust, setAdjust] = useState({ quantity: "", note: "" });
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ resource: "products", page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load inventory");
        return;
      }
      setItems(d.data.items);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
    } catch {
      if (my === reqId.current) toast.error("Could not load inventory. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  function open(p: Item) {
    setAdjustId(adjustId === p.id ? null : p.id);
    setAdjust({ quantity: "", note: "" });
    fe.clear();
  }

  async function submitAdjust(p: Item) {
    if (!fe.check(stockAdjustSchema, adjust)) return;
    const qty = Number(adjust.quantity);
    const limit = stockAdjustLimitError(qty, { stock: p.stockQuantity, reserved: p.reservedStock });
    if (limit) {
      fe.setErrors({ quantity: limit });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "stock", data: { productId: p.id, quantity: qty, note: adjust.note } }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        return;
      }
      toast.success(`${p.name}: stock ${data.data.previousStock} → ${data.data.newStock}`);
      setAdjustId(null);
      void load();
    } catch {
      fe.setFormError("Could not adjust stock. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Inventory</h1>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search product, SKU or store…"
          aria-label="Search inventory"
          className="w-full rounded-full border px-4 py-2 text-sm sm:w-72"
        />
      </div>
      <p className="mt-1 text-sm text-ink-subtle">
        Use &quot;Adjust&quot; to add (e.g. 10) or remove (e.g. -5) stock. Removing stock needs a reason and can&apos;t
        go below units reserved for open orders.
      </p>

      <div className="mt-6 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-brand-50 dark:bg-brand-500/10">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Current</th>
              <th className="px-4 py-3">Reserved</th>
              <th className="px-4 py-3">Available</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">
                  {query ? `No products match "${query}".` : "No products yet."}
                </td>
              </tr>
            )}
            {items.map((p) => {
              const low = p.availableStock <= (p.lowStockThreshold || 5);
              return (
                <Fragment key={p.id}>
                  <tr className="border-t">
                    <td className="px-4 py-3">
                      {p.name}
                      <span className="ml-2 text-xs text-ink-subtle">{p.sku}</span>
                      {p.store?.name && <span className="block text-xs text-ink-subtle">{p.store.name}</span>}
                    </td>
                    <td className="px-4 py-3">{p.stockQuantity}</td>
                    <td className="px-4 py-3">{p.reservedStock}</td>
                    <td className="px-4 py-3">{p.availableStock}</td>
                    <td className="px-4 py-3">
                      {p.availableStock <= 0 ? "Out of stock" : low ? "Low stock" : "OK"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => open(p)}
                        className="rounded-full bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-xs font-semibold text-ink"
                      >
                        {adjustId === p.id ? "Close" : "Adjust"}
                      </button>
                    </td>
                  </tr>
                  {adjustId === p.id && (
                    <tr className="bg-brand-50 dark:bg-brand-500/10">
                      <td colSpan={6} className="px-4 py-3">
                        <form
                          noValidate
                          onSubmit={(e) => {
                            e.preventDefault();
                            void submitAdjust(p);
                          }}
                          className="flex flex-wrap items-start gap-2"
                        >
                          <label className="text-sm">
                            <span className="mb-1 block text-xs font-medium text-ink">Change (+/−)</span>
                            <input
                              type="number"
                              step={1}
                              inputMode="numeric"
                              placeholder="e.g. 10 or -5"
                              aria-invalid={fe.has("quantity")}
                              className={inputClass(fe.has("quantity"), "w-36 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2")}
                              value={adjust.quantity}
                              onChange={(e) => {
                                setAdjust({ ...adjust, quantity: e.target.value });
                                fe.clear("quantity");
                              }}
                            />
                            <FieldError message={fe.get("quantity")} />
                          </label>
                          <label className="min-w-0 flex-1 text-sm">
                            <span className="mb-1 block text-xs font-medium text-ink">
                              Reason {Number(adjust.quantity) < 0 ? "(required)" : "(optional)"}
                            </span>
                            <input
                              maxLength={200}
                              placeholder="e.g. Damaged in storage"
                              aria-invalid={fe.has("note")}
                              className={inputClass(fe.has("note"), "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2")}
                              value={adjust.note}
                              onChange={(e) => {
                                setAdjust({ ...adjust, note: e.target.value });
                                fe.clear("note");
                              }}
                            />
                            <FieldError message={fe.get("note") || fe.formError} />
                          </label>
                          <button
                            type="submit"
                            disabled={saving}
                            className="mt-5 rounded-full bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="products"
      />
    </div>
  );
}
