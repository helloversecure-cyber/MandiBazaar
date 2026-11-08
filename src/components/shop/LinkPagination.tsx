"use client";

import { Pagination } from "@/components/ui/Pagination";

/**
 * <Pagination hrefFor> for server-rendered shop pages (functions can't be passed
 * from a server component, so the link builder lives here). Keeps every other
 * query param and writes ?page=N (page 1 drops the param).
 */
export function LinkPagination({
  basePath,
  query = "",
  page,
  totalPages,
  total,
  pageSize,
  itemLabel,
}: {
  basePath: string;
  query?: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  itemLabel?: string;
}) {
  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      total={total}
      pageSize={pageSize}
      itemLabel={itemLabel}
      hrefFor={(p) => {
        const sp = new URLSearchParams(query);
        if (p <= 1) sp.delete("page");
        else sp.set("page", String(p));
        const qs = sp.toString();
        return qs ? `${basePath}?${qs}` : basePath;
      }}
    />
  );
}
