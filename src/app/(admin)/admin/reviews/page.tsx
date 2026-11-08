"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/feedback";

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: string;
  user: { fullName: string };
  product: { id: string; name: string; slug: string; store?: { name: string } | null } | null;
};

const PAGE_SIZE = 25;
const STATUS_TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "HIDDEN", label: "Hidden" },
  { key: "", label: "All" },
] as const;

export default function AdminReviewsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Review[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [rating, setRating] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      const params = new URLSearchParams({ admin: "1", page: String(page), limit: String(PAGE_SIZE) });
      if (status) params.set("status", status);
      if (rating) params.set("rating", rating);
      if (query) params.set("q", query);
      const res = await fetch(`/api/reviews?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load reviews");
        return;
      }
      setItems(d.data.items);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
    } catch {
      if (my === reqId.current) toast.error("Could not load reviews. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, rating, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setReviewStatus(r: Review, next: "APPROVED" | "HIDDEN") {
    setBusyId(r.id);
    try {
      const res = await fetch("/api/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, status: next }),
      });
      const d = await res.json();
      if (!d.success) {
        toast.error(d.error || "Update failed");
        return;
      }
      toast.success(next === "APPROVED" ? "Review approved — shown on the product page" : "Review hidden");
      void load();
    } catch {
      toast.error("Update failed. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Reviews</h1>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => {
                setStatus(t.key);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs ${
                status === t.key ? "bg-brand-600 text-white" : "bg-brand-50 dark:bg-brand-500/10 text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <select
            value={rating}
            onChange={(e) => {
              setRating(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by rating"
            className="rounded-full border px-3 py-2 text-sm"
          >
            <option value="">Any rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} star{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search product, customer or text…"
            aria-label="Search reviews"
            className="min-w-0 flex-1 rounded-full border px-4 py-2 text-sm sm:w-64"
          />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {items.map((r) => (
          <div key={r.id} className="rounded-2xl bg-card p-4 shadow-card">
            <p className="font-medium">
              {r.user.fullName} · {r.rating}/5 · <span className="text-xs uppercase">{r.status}</span>
            </p>
            {r.product && (
              <p className="text-xs text-ink-subtle">
                <Link href={`/products/${r.product.slug}`} className="underline" target="_blank">
                  {r.product.name}
                </Link>
                {r.product.store?.name ? ` · ${r.product.store.name}` : ""} ·{" "}
                {new Date(r.createdAt).toLocaleDateString()}
              </p>
            )}
            {r.comment && <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">{r.comment}</p>}
            <div className="mt-2 flex gap-3 text-xs">
              {r.status !== "APPROVED" && (
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void setReviewStatus(r, "APPROVED")}
                  className="font-semibold text-leaf-600 disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              {r.status !== "HIDDEN" && (
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void setReviewStatus(r, "HIDDEN")}
                  className="font-semibold text-honey-600 disabled:opacity-50"
                >
                  Hide
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && !items.length && (
          <p className="text-ink-subtle">
            {query || rating ? "No reviews match these filters." : status === "PENDING" ? "No reviews waiting." : "No reviews yet."}
          </p>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} itemLabel="reviews" />
    </div>
  );
}
