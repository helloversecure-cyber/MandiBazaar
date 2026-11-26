"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { BiddingTabs } from "@/components/admin/BiddingTabs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { listStatusInfo } from "@/lib/lists/ui";
import { cn, formatCurrency } from "@/lib/utils";

type Row = {
  id: string;
  status: string;
  city: string;
  area: string | null;
  customerName: string;
  lineCount: number;
  storesSent: number;
  offersCount: number;
  radiusKm: number;
  createdAt: string;
  expiresAt: string;
  round: number;
  roundEndsAt: string;
  acceptedStore: string | null;
  acceptedTotal: number | null;
  order: { orderNumber: string; orderStatus: string } | null;
};

const FILTERS = ["ALL", "BIDDING", "ACCEPTED", "CANCELLED", "NO_STORES", "EXPIRED"] as const;
const PAGE_SIZE = 20;

/** Admin wording (the shared labels are written for the customer). */
function statusLabel(s: string) {
  if (s === "BIDDING") return "Bidding";
  if (s === "ACCEPTED") return "Offer accepted";
  return listStatusInfo(s).label;
}

export default function AdminItemListsPage() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pg, setPg] = useState({ total: 0, totalPages: 1 });
  const [needsRider, setNeedsRider] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
    if (q) p.set("q", q);
    try {
      const d = await fetch(`/api/admin/lists?${p}`, { cache: "no-store" }).then((r) => r.json());
      if (!d.success) {
        setError(d.error || "Couldn't load lists");
        setRows([]);
        return;
      }
      setError("");
      setRows(d.data.items);
      setCounts(d.data.counts || {});
      setPg({ total: d.data.pagination.total, totalPages: d.data.pagination.totalPages });
    } catch {
      setError("Couldn't load lists");
    }
  }, [status, page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin/lists?view=needs-rider", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.success && setNeedsRider(d.data.needsRider.length))
      .catch(() => {});
  }, []);

  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <BiddingTabs needsRider={needsRider} />
      <h1 className="font-display text-3xl text-ink">Item lists</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Every shopping list customers sent to stores, with the offers it got and the order it became.
      </p>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
            className={cn(
              "press min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold",
              status === f ? "bg-brand-600 text-white" : "bg-card text-ink-muted ring-1 ring-line hover:text-ink"
            )}
          >
            {f === "ALL" ? "All" : statusLabel(f)} ({f === "ALL" ? all : counts[f] ?? 0})
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(qInput.trim());
        }}
      >
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={qInput}
            maxLength={60}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Customer, city, order number or list id"
            aria-label="Search lists"
            className="min-h-[44px] w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {rows === null ? (
        <div className="skeleton mt-5 h-48 rounded-2xl" />
      ) : rows.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-line bg-card px-4 py-10 text-center text-sm text-ink-subtle">
          No lists here.
        </p>
      ) : (
        <>
          {/* Cards below 768 px, table from 768 px (L-08). */}
          <ul className="mt-5 space-y-3 md:hidden" data-testid="lists-cards">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/bidding/lists/${r.id}`} className="block rounded-2xl border border-line bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={listStatusInfo(r.status).tone} dot>
                        {statusLabel(r.status)}
                      </Badge>
                      <Badge tone="neutral">Round {r.round}</Badge>
                    </span>
                    <span className="text-xs text-ink-subtle">{new Date(r.createdAt).toLocaleString("en-PK")}</span>
                  </div>
                  <p className="mt-2 font-semibold text-ink">{r.customerName}</p>
                  <p className="text-sm text-ink-muted">
                    {[r.area, r.city].filter(Boolean).join(", ")} · {r.lineCount} items · {r.radiusKm} km
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Sent to {r.storesSent} · {r.offersCount} offer{r.offersCount === 1 ? "" : "s"}
                    {r.order ? ` · ${r.order.orderNumber}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-5 hidden overflow-x-auto rounded-2xl border border-line bg-card md:block">
            <table className="w-full text-left text-sm" data-testid="lists-table">
              <thead className="bg-app text-xs uppercase text-ink-subtle">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Round</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Area</th>
                  <th className="px-4 py-3 text-right font-semibold">Items</th>
                  <th className="px-4 py-3 text-right font-semibold">Stores / offers</th>
                  <th className="px-4 py-3 font-semibold">Accepted</th>
                  <th className="px-4 py-3 font-semibold">Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <Link href={`/admin/bidding/lists/${r.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                        <Badge tone={listStatusInfo(r.status).tone} dot className="whitespace-nowrap">
                          {statusLabel(r.status)}
                        </Badge>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" data-testid="list-round-cell">
                      {r.round}
                      {r.status === "BIDDING" && (
                        <span className="block whitespace-nowrap text-xs text-ink-subtle">
                          ends {new Date(r.roundEndsAt).toLocaleString("en-PK")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/bidding/lists/${r.id}`} className="whitespace-nowrap font-medium text-ink hover:underline">
                        {r.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {[r.area, r.city].filter(Boolean).join(", ")}
                      <span className="block text-xs text-ink-subtle">radius {r.radiusKm} km</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.lineCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.storesSent} / {r.offersCount}
                    </td>
                    <td className="px-4 py-3">
                      {r.order ? (
                        <Link href={`/admin/orders/${r.order.orderNumber}`} className="whitespace-nowrap font-semibold text-brand-700 hover:underline dark:text-brand-300">
                          {r.order.orderNumber}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                      {r.acceptedStore && (
                        <span className="block text-xs text-ink-subtle">
                          {r.acceptedStore}
                          {r.acceptedTotal != null ? ` · ${formatCurrency(r.acceptedTotal)}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-subtle">{new Date(r.createdAt).toLocaleString("en-PK")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination
        page={page}
        totalPages={pg.totalPages}
        total={pg.total}
        pageSize={PAGE_SIZE}
        onPageChange={(n) => setPage(n)}
        itemLabel="lists"
      />
    </div>
  );
}
