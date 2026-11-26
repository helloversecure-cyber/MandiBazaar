"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Clock, MapPin, Package, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Countdown } from "@/components/lists/ListBits";
import { listOpen, storeListState, type StoreListRow } from "@/lib/lists/store-ui";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const TABS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function StoreIncomingListsPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StoreListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/store/lists?filter=${tab}&page=${page}&limit=${PAGE_SIZE}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Couldn't load lists.");
        setRows([]);
        return;
      }
      setError("");
      setRows(data.data.items);
      setTotal(data.data.pagination.total);
      setTotalPages(data.data.pagination.totalPages);
    } catch {
      setError("We couldn't reach MandiBazaar. Check your connection.");
    }
  }, [tab, page]);

  useEffect(() => {
    setRows(null);
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl text-ink">Incoming lists</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Customers near you sent these shopping lists. Price what you have and the customer picks the best offer.
            You only see the area, never the customer&apos;s name, phone or house.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-sm font-medium text-ink-muted hover:text-ink"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="mt-5 flex gap-2" role="tablist" aria-label="Which lists">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={cn(
              "press min-h-[44px] rounded-full px-4 text-sm font-semibold transition",
              tab === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-card text-ink-muted ring-1 ring-line hover:text-ink"
            )}
          >
            {t.label}
            {tab === t.key && rows ? ` (${total})` : ""}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-3" data-testid="store-lists">
        {rows === null && (
          <>
            <div className="skeleton h-28 rounded-2xl" />
            <div className="skeleton h-28 rounded-2xl" />
          </>
        )}
        {rows?.length === 0 && !error && (
          <div className="rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center text-sm text-ink-subtle">
            <ClipboardList className="mx-auto mb-3 h-8 w-8" />
            {tab === "open"
              ? "No open lists right now. New lists from customers near your store show up here."
              : "No lists have been sent to your store yet."}
          </div>
        )}
        {rows?.map((r) => (
          <ListRowCard key={`${r.listId}:${r.storeId}`} row={r} onEnd={() => void load()} />
        ))}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={(n) => {
          setPage(n);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        itemLabel="lists"
      />
    </div>
  );
}

function ListRowCard({ row, onEnd }: { row: StoreListRow; onEnd: () => void }) {
  const state = storeListState(row);
  const open = listOpen(row);
  const href = `/store-portal/lists/${row.listId}?storeId=${encodeURIComponent(row.storeId)}`;
  const place = [row.area, row.city].filter(Boolean).join(", ");
  return (
    <Link
      href={href}
      data-testid="store-list-row"
      className={cn(
        "block rounded-2xl border bg-card p-4 shadow-card transition hover:border-brand-300",
        state.key === "NEW" || state.key === "UPDATE_NEEDED" ? "border-brand-200 dark:border-brand-500/30" : "border-line"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={state.tone} dot>
            {state.label}
          </Badge>
          {!row.seen && open && <Badge tone="warning">New</Badge>}
        </div>
        {open ? (
          <span className="flex items-center gap-1 text-xs font-medium text-ink-muted">
            <Clock className="h-3.5 w-3.5" />
            <Countdown until={row.expiresAt} onEnd={onEnd} />
          </span>
        ) : (
          <span className="text-xs text-ink-subtle">{new Date(row.sentAt).toLocaleDateString("en-PK")}</span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <p className="flex min-w-0 items-center gap-1.5 text-ink">
          <MapPin className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="truncate">{place || "Area not given"}</span>
        </p>
        <p className="flex items-center gap-1.5 text-ink-muted">
          <Package className="h-4 w-4 shrink-0 text-ink-subtle" />
          {row.lineCount} item{row.lineCount === 1 ? "" : "s"}
        </p>
        <p className="text-ink-muted">{row.distanceKm != null ? `${row.distanceKm.toFixed(1)} km from your store` : "Same city"}</p>
      </div>
      {row.myBid && row.myBid.status !== "WITHDRAWN" && (
        <p className="mt-2 text-sm text-ink-muted">
          Your offer: <span className="font-semibold text-ink">{formatCurrency(row.myBid.total)}</span> for{" "}
          {row.myBid.coveredCount} of {row.lineCount} items
          {row.myBid.orderNumber ? ` · order ${row.myBid.orderNumber}` : ""}
        </p>
      )}
    </Link>
  );
}
