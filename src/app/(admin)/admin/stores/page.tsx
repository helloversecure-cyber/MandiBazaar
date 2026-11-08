"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { formatCurrency } from "@/lib/utils";
import {
  storeApprovalErrorMessage,
  storeApprovalMissingText,
  type StoreApprovalGap,
} from "@/lib/catalog/store-approval";

type Store = {
  id: string;
  name: string;
  slug: string;
  status: string;
  city: string;
  phone: string | null;
  isVirtual: boolean;
  requestedCategories?: string[];
  rejectionReason: string | null;
  suspensionReason: string | null;
  suspendedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  approvalGaps: StoreApprovalGap[];
  owner: { fullName: string; phone: string | null; email: string | null };
  documents: { type: string; url: string }[];
  _count: { products: number };
};

type Category = { id: string; name: string; slug: string; isActive: boolean };

const TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "SUSPENDED", label: "Suspended" },
] as const;

const PAGE_SIZE = 25;
const REASON = { required: true, minLength: 5, maxLength: 500 } as const;

export default function AdminStoresPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [status, setStatus] = useState<string>("PENDING");
  const [items, setItems] = useState<Store[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
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
    setLoadError("");
    try {
      const params = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      const res = await fetch(`/api/stores?${params}`);
      const data = await res.json();
      if (my !== reqId.current) return;
      if (!data.success) {
        setLoadError(data.error || "Could not load stores");
        return;
      }
      setItems(data.data.items || []);
      setCounts(data.data.counts || {});
      setTotal(data.data.pagination?.total ?? 0);
      setTotalPages(data.data.pagination?.totalPages ?? 1);
    } catch {
      if (my === reqId.current) setLoadError("Could not load stores. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [status, page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin?resource=categories")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCategories(d.data.items || []);
      })
      .catch(() => {});
  }, []);

  function categoryExists(name: string) {
    const key = name.trim().toLowerCase();
    return categories.some((c) => c.isActive && c.name.trim().toLowerCase() === key);
  }

  function switchTab(next: string) {
    setStatus(next);
    setPage(1);
  }

  async function patch(storeId: string, body: Record<string, unknown>) {
    setBusyId(storeId);
    try {
      const res = await fetch("/api/stores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, ...body }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Action failed");
        return null;
      }
      return data.data;
    } catch {
      toast.error("Action failed. Check your connection and try again.");
      return null;
    } finally {
      setBusyId(null);
    }
  }

  function movedToast(text: string, tab: string) {
    toast.success(text, {
      action: { label: `View ${tab.toLowerCase()}`, onClick: () => switchTab(tab) },
      durationMs: 6000,
    });
  }

  async function approve(s: Store) {
    if (s.approvalGaps.length) {
      toast.error(storeApprovalErrorMessage(s.approvalGaps));
      return;
    }
    const missingCats = (s.requestedCategories || []).filter((n) => !categoryExists(n));
    const r = await confirm({
      title: `Approve ${s.name}?`,
      message: (
        <>
          <p>The owner will be able to sell immediately and approved products will show in the shop.</p>
          {missingCats.length > 0 && (
            <p className="mt-2">
              These requested categories will be created: <strong>{missingCats.join(", ")}</strong>. Add an image
              to each one before activating it.
            </p>
          )}
        </>
      ),
      confirmLabel: "Approve store",
    });
    if (!r.confirmed) return;
    const data = await patch(s.id, { action: "APPROVE", createRequestedCategories: true });
    if (!data) return;
    const created = (data.categoriesCreated as string[] | undefined) || [];
    movedToast(
      created.length ? `${s.name} approved. Created categories: ${created.join(", ")}` : `${s.name} approved`,
      "APPROVED"
    );
    await load();
  }

  async function reject(s: Store) {
    const r = await confirm({
      title: `Reject ${s.name}?`,
      message: "The application will move to Rejected. The owner sees your reason in their portal and by SMS.",
      confirmLabel: "Reject application",
      tone: "danger",
      reason: { label: "Reason (shown to the store owner)", placeholder: "e.g. CNIC photo is not readable", ...REASON },
    });
    if (!r.confirmed) return;
    const data = await patch(s.id, { action: "REJECT", rejectionReason: r.reason });
    if (!data) return;
    movedToast(`${s.name} rejected`, "REJECTED");
    await load();
  }

  async function suspend(s: Store) {
    setBusyId(s.id);
    let impact: { openOrders: number; pendingPayoutAmount: number; pendingPayoutCount: number } | null = null;
    try {
      const res = await fetch(`/api/stores?impact=${encodeURIComponent(s.id)}`);
      const d = await res.json();
      if (d.success) impact = d.data;
    } catch {
      /* show the dialog without numbers */
    } finally {
      setBusyId(null);
    }
    const r = await confirm({
      title: `Suspend ${s.name}?`,
      message: (
        <>
          <p>Its products will disappear from the shop and customers can&apos;t order from it.</p>
          {impact ? (
            <p className="mt-2">
              Open orders: <strong>{impact.openOrders}</strong>. Pending payouts:{" "}
              <strong>{formatCurrency(impact.pendingPayoutAmount)}</strong>
              {impact.pendingPayoutCount ? ` (${impact.pendingPayoutCount})` : ""}. Open orders still need to be
              delivered or cancelled, and pending payouts stay owed to the store.
            </p>
          ) : (
            <p className="mt-2">Couldn&apos;t load open orders and pending payouts — check them before suspending.</p>
          )}
        </>
      ),
      confirmLabel: "Suspend store",
      tone: "danger",
      reason: { label: "Reason (shown to the store owner)", placeholder: "e.g. Repeated late deliveries", ...REASON },
    });
    if (!r.confirmed) return;
    const data = await patch(s.id, { action: "SUSPEND", suspensionReason: r.reason });
    if (!data) return;
    movedToast(`${s.name} suspended`, "SUSPENDED");
    await load();
  }

  async function reactivate(s: Store) {
    if (s.approvalGaps.length) {
      toast.error(storeApprovalErrorMessage(s.approvalGaps));
      return;
    }
    const r = await confirm({
      title: `Reactivate ${s.name}?`,
      message: "The store can sell again and its approved products will show in the shop immediately.",
      confirmLabel: "Reactivate store",
    });
    if (!r.confirmed) return;
    const data = await patch(s.id, { action: "REACTIVATE" });
    if (!data) return;
    movedToast(`${s.name} reactivated`, "APPROVED");
    await load();
  }

  async function createCategories(s: Store) {
    const data = await patch(s.id, { action: "CREATE_REQUESTED_CATEGORIES" });
    if (!data) return;
    toast.success(data.message || "Categories updated");
    fetch("/api/admin?resource=categories")
      .then((r) => r.json())
      .then((d) => d.success && setCategories(d.data.items || []))
      .catch(() => {});
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Stores</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Review seller documents, payout details and map location, then approve. Stores can&apos;t be approved
        without a payout method and a map location.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => switchTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs ${
                status === t.key ? "bg-brand-600 text-white" : "bg-brand-50 dark:bg-brand-500/10 text-ink"
              }`}
            >
              {t.label}
              {counts[t.key] != null ? ` (${counts[t.key]})` : ""}
            </button>
          ))}
        </div>
        <label className="w-full sm:w-72">
          <span className="sr-only">Search stores</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search store, owner or phone…"
            className="w-full rounded-full border border-line px-4 py-2 text-sm"
          />
        </label>
      </div>

      {loadError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{loadError}</p>}

      <div className="mt-6 space-y-4">
        {items.map((s) => {
          const requested = s.requestedCategories || [];
          const missing = requested.filter((name) => !categoryExists(name));
          const gapsText = storeApprovalMissingText(s.approvalGaps);
          const blockTip = s.approvalGaps.length ? storeApprovalErrorMessage(s.approvalGaps) : undefined;
          const busy = busyId === s.id;
          return (
            <div key={s.id} className="rounded-2xl bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-xl">{s.name}</p>
                  <p className="text-sm text-ink-subtle">
                    {s.owner.fullName} · {s.owner.phone || "no phone"} · {s.city}
                    {s.isVirtual ? " · Virtual" : ""} · {s._count.products} products
                  </p>
                  <p className="text-xs text-ink-subtle">Applied {new Date(s.createdAt).toLocaleDateString()}</p>
                  {gapsText && (s.status === "PENDING" || s.status === "APPROVED" || s.status === "SUSPENDED" || s.status === "REJECTED") && (
                    <p className="mt-2 inline-block rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                      {gapsText}
                    </p>
                  )}
                  {s.status === "REJECTED" && s.rejectionReason && (
                    <p className="mt-2 text-xs text-red-700">Rejected: {s.rejectionReason}</p>
                  )}
                  {s.status === "SUSPENDED" && (
                    <p className="mt-2 text-xs text-red-700">
                      Suspended{s.suspendedAt ? ` on ${new Date(s.suspendedAt).toLocaleDateString()}` : ""}
                      {s.suspensionReason ? `: ${s.suspensionReason}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.status === "PENDING" && (
                    <>
                      {missing.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void createCategories(s)}
                        >
                          Create missing categories ({missing.length})
                        </Button>
                      )}
                      <span title={blockTip} className="inline-flex">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || s.approvalGaps.length > 0}
                          aria-describedby={blockTip ? `gaps-${s.id}` : undefined}
                          onClick={() => void approve(s)}
                        >
                          Approve & sync categories
                        </Button>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void reject(s)}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {s.status === "APPROVED" && (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void suspend(s)}>
                      Suspend
                    </Button>
                  )}
                  {s.status === "SUSPENDED" && (
                    <span title={blockTip} className="inline-flex">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || s.approvalGaps.length > 0}
                        onClick={() => void reactivate(s)}
                      >
                        Reactivate
                      </Button>
                    </span>
                  )}
                  {s.status === "REJECTED" && (
                    <>
                      {missing.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void createCategories(s)}
                        >
                          Create missing categories ({missing.length})
                        </Button>
                      )}
                      <span title={blockTip} className="inline-flex">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || s.approvalGaps.length > 0}
                          aria-describedby={blockTip ? `gaps-${s.id}` : undefined}
                          onClick={() => void approve(s)}
                        >
                          Approve & sync categories
                        </Button>
                      </span>
                    </>
                  )}
                </div>
              </div>
              {blockTip && (s.status === "PENDING" || s.status === "SUSPENDED" || s.status === "REJECTED") && (
                <p id={`gaps-${s.id}`} className="mt-2 text-xs text-ink-subtle">
                  {blockTip}
                </p>
              )}

              {requested.length > 0 && (
                <div className="mt-4 rounded-xl border border-line bg-brand-50 dark:bg-brand-500/10 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Categories this store wants to sell
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {requested.map((name) => {
                      const exists = categoryExists(name);
                      return (
                        <span
                          key={name}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            exists ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          {name}
                          {exists ? " · ready" : " · missing"}
                        </span>
                      );
                    })}
                  </div>
                  {s.status === "PENDING" && missing.length > 0 && (
                    <p className="mt-2 text-xs text-ink-subtle">
                      Missing categories will be created automatically when you click &quot;Approve & sync
                      categories&quot;.
                    </p>
                  )}
                </div>
              )}

              {s.documents?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.documents.map((d, i) => (
                    <a
                      key={i}
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-brand-50 dark:bg-brand-500/10 px-2 py-1 text-xs text-ink underline"
                    >
                      {d.type.replace(/_/g, " ").toLowerCase()}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!loading && !items.length && !loadError && (
          <p className="text-sm text-ink-subtle">
            {query ? `No stores match "${query}" in this tab.` : "No stores in this tab."}
          </p>
        )}
        {loading && !items.length && <p className="text-sm text-ink-subtle">Loading stores…</p>}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="stores"
      />
    </div>
  );
}
