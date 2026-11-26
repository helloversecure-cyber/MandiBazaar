"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { Countdown, ListStatusBadge, RoundBadge } from "@/components/lists/ListBits";
import { useListBidding } from "@/components/lists/useListBidding";
import type { ListSummary } from "@/components/lists/types";
import { plural } from "@/lib/portal/format";

const PAGE_SIZE = 10;

function MyListsContent() {
  const sp = useSearchParams();
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const enabled = useListBidding();
  const [items, setItems] = useState<ListSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetch(`/api/lists?page=${page}&limit=${PAGE_SIZE}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d?.success) {
          setError(d?.error || "Couldn't load your lists.");
          setItems([]);
          return;
        }
        setItems(d.data.items || []);
        setTotal(d.data.pagination?.total || 0);
        setTotalPages(d.data.pagination?.totalPages || 1);
      })
      .catch(() => {
        if (alive) {
          setError("Couldn't load your lists. Check your connection and try again.");
          setItems([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [page]);

  const newButton = enabled ? (
    <Button href="/lists/new" size="sm">
      Send a new list
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title="My lists" subtitle={plural(total, "list")} badge="Lists" action={newButton} />

      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      {items === null ? (
        <div className="space-y-3">
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-24 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No lists yet"
          description="Send a shopping list to nearby stores and they'll reply with their prices."
          actionLabel={enabled ? "Send a list" : undefined}
          actionHref={enabled ? "/lists/new" : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((l) => {
            const names = l.lines.map((x) => x.name);
            return (
              <li key={l.id}>
                <Link
                  href={`/account/lists/${l.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 shadow-card transition hover:border-brand-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ListStatusBadge status={l.status} />
                      {(l.status === "BIDDING" || l.round > 1) && <RoundBadge round={l.round} />}
                      <span className="text-xs text-ink-subtle">{new Date(l.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1.5 truncate font-semibold text-ink">
                      {names.slice(0, 3).join(", ")}
                      {names.length > 3 ? ` +${names.length - 3} more` : ""}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-muted">
                      <span>{plural(l.lines.length, "item")}</span>
                      {l.status === "BIDDING" && (
                        <>
                          <span className="font-semibold text-brand-700 dark:text-brand-300">{plural(l.offerCount, "offer")}</span>
                          <Countdown until={l.roundEndsAt ?? l.expiresAt} />
                        </>
                      )}
                      {l.orderNumber && <span>Order {l.orderNumber}</span>}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        hrefFor={(p) => (p > 1 ? `/account/lists?page=${p}` : "/account/lists")}
        itemLabel="lists"
      />
    </div>
  );
}

export default function MyListsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-2xl" />}>
      <MyListsContent />
    </Suspense>
  );
}
