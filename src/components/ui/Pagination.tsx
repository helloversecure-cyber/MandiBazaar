"use client";

import Link from "next/link";

/**
 * Page controls for any list (QA section Q).
 *
 * Link mode (shop pages, keeps ?page= in the URL so Back/share works):
 *   <Pagination page={page} totalPages={n} total={total} pageSize={20} hrefFor={(p) => `/products?${qs(p)}`} />
 * Button mode (admin tables):
 *   <Pagination page={page} totalPages={n} total={total} pageSize={25} onPageChange={setPage} />
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  hrefFor,
  className = "",
  itemLabel = "items",
}: {
  page: number;
  totalPages: number;
  total?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  hrefFor?: (page: number) => string;
  className?: string;
  itemLabel?: string;
}) {
  const pages = Math.max(1, totalPages || 1);
  const current = Math.min(Math.max(1, page), pages);

  const summary =
    total != null && pageSize
      ? total === 0
        ? `No ${itemLabel}`
        : `Showing ${((current - 1) * pageSize + 1).toLocaleString("en-PK")}–${Math.min(
            current * pageSize,
            total
          ).toLocaleString("en-PK")} of ${total.toLocaleString("en-PK")} ${itemLabel}`
      : null;

  if (pages <= 1) {
    return summary ? <p className={`mt-4 text-center text-xs text-slate-500 ${className}`}>{summary}</p> : null;
  }

  const nums = pageWindow(current, pages);

  const item = (p: number, label: React.ReactNode, opts: { active?: boolean; disabled?: boolean; aria?: string } = {}) => {
    const cls = `inline-flex min-w-9 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition ${
      opts.active
        ? "bg-brand-600 text-white"
        : opts.disabled
          ? "cursor-not-allowed text-slate-300"
          : "text-slate-700 hover:bg-slate-100"
    }`;
    if (opts.disabled || opts.active) {
      return (
        <span key={`${String(label)}-${p}`} className={cls} aria-current={opts.active ? "page" : undefined}>
          {label}
        </span>
      );
    }
    if (hrefFor) {
      return (
        <Link key={`${String(label)}-${p}`} href={hrefFor(p)} className={cls} aria-label={opts.aria} scroll>
          {label}
        </Link>
      );
    }
    return (
      <button
        key={`${String(label)}-${p}`}
        type="button"
        className={cls}
        aria-label={opts.aria}
        onClick={() => onPageChange?.(p)}
      >
        {label}
      </button>
    );
  };

  return (
    <nav aria-label="Pagination" className={`mt-6 flex flex-col items-center gap-2 ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {item(current - 1, "‹ Prev", { disabled: current <= 1, aria: "Previous page" })}
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-slate-400">
              …
            </span>
          ) : (
            item(n, n, { active: n === current, aria: `Page ${n}` })
          )
        )}
        {item(current + 1, "Next ›", { disabled: current >= pages, aria: "Next page" })}
      </div>
      {summary && <p className="text-xs text-slate-500">{summary}</p>}
    </nav>
  );
}

/** 1 … 4 5 [6] 7 8 … 20 */
export function pageWindow(current: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(pages - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push("…");
  out.push(pages);
  return out;
}
