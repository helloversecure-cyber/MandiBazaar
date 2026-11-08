"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: string;
  product: { id: string; name: string; slug: string };
};

export default function AccountReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reviews?mine=true")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setReviews(d.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="My reviews"
        subtitle="Reviews you have submitted for purchased products"
        badge="Reviews"
      />

      {loading && (
        <p className="py-8 text-center text-sm text-ink-subtle">Loading reviews…</p>
      )}

      {!loading && !reviews.length && (
        <p className="rounded-2xl border border-dashed border-line py-10 text-center text-sm text-ink-subtle">
          No reviews yet. After an order is delivered, you can leave a review from the
          order detail page.
        </p>
      )}

      <div className="space-y-3">
        {reviews.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-line bg-card p-4 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link
                  href={`/products/${r.product.slug}`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  {r.product.name}
                </Link>
                <div className="mt-1 flex items-center gap-0.5 text-amber-400">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "h-3.5 w-3.5",
                        i < r.rating ? "fill-current" : "text-slate-200"
                      )}
                    />
                  ))}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                  r.status === "APPROVED"
                    ? "bg-emerald-100 text-emerald-700"
                    : r.status === "REJECTED"
                      ? "bg-red-100 text-red-600"
                      : "bg-amber-100 text-amber-700"
                )}
              >
                {r.status}
              </span>
            </div>
            {r.comment && (
              <p className="mt-2 text-sm text-ink-muted">{r.comment}</p>
            )}
            <p className="mt-2 text-xs text-ink-subtle">
              {new Date(r.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
