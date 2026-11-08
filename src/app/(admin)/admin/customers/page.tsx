"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";

type Customer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  orderCount: number;
  totalSpent: number;
  lastOrder: string | null;
  createdAt: string;
  phoneInvalid: boolean;
};

const PAGE_SIZE = 25;

export default function AdminCustomersPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [invalidOnly, setInvalidOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [scanCapped, setScanCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqId = useRef(0);

  // Search as you type (300 ms)
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
      const params = new URLSearchParams({ resource: "customers", page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      if (invalidOnly) params.set("filter", "invalid-phone");
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load customers");
        return;
      }
      setItems(d.data.items);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
      setScanCapped(Boolean(d.data.scanCapped));
    } catch {
      if (my === reqId.current) toast.error("Could not load customers. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, invalidOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(c: Customer) {
    const deactivating = c.isActive;
    const r = await confirm({
      title: deactivating ? `Deactivate ${c.fullName}?` : `Activate ${c.fullName}?`,
      message: deactivating
        ? "They won't be able to sign in or place orders. Their order history is kept."
        : "They can sign in and order again.",
      confirmLabel: deactivating ? "Deactivate" : "Activate",
      tone: deactivating ? "danger" : "default",
    });
    if (!r.confirmed) return;
    setBusyId(c.id);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "customer", id: c.id, data: { isActive: !c.isActive } }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Update failed");
        return;
      }
      toast.success(`${c.fullName} ${deactivating ? "deactivated" : "activated"}`);
      void load();
    } catch {
      toast.error("Update failed. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl">Customers</h1>
        <div className="w-full sm:w-80">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone or email…"
            aria-label="Search customers"
            aria-describedby="customer-search-hint"
            className="w-full rounded-full border px-4 py-2 text-sm"
          />
          <p id="customer-search-hint" className="mt-1 px-2 text-xs text-ink-subtle">
            Results update as you type.
          </p>
        </div>
      </div>

      <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={invalidOnly}
          onChange={(e) => {
            setInvalidOnly(e.target.checked);
            setPage(1);
          }}
        />
        Accounts with invalid phone numbers
      </label>
      {invalidOnly && (
        <p className="mt-1 text-xs text-ink-subtle">
          Showing customers whose phone is missing or not a valid Pakistani mobile (03XXXXXXXXX). Review and
          deactivate junk accounts.
          {scanCapped ? " Only the newest 5,000 accounts were checked." : ""}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-brand-50 dark:bg-brand-500/10">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Total spent</th>
              <th className="px-4 py-3">Last order</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                  {query
                    ? `No customers match "${query}"${invalidOnly ? " with an invalid phone" : ""}.`
                    : invalidOnly
                      ? "No accounts with invalid phone numbers."
                      : "No customers yet."}
                </td>
              </tr>
            )}
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                  Loading customers…
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-3 font-medium">
                  {c.fullName}
                  {c.email && <span className="block text-xs font-normal text-ink-subtle">{c.email}</span>}
                </td>
                <td className="px-4 py-3">
                  {c.phone || "—"}
                  {c.phoneInvalid && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                      Invalid
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{c.orderCount}</td>
                <td className="px-4 py-3">{formatCurrency(c.totalSpent)}</td>
                <td className="px-4 py-3">{c.lastOrder ? new Date(c.lastOrder).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      c.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-ink-subtle"
                    }`}
                  >
                    {c.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === c.id}
                    onClick={() => void toggleActive(c)}
                  >
                    {c.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="customers"
      />
    </div>
  );
}
