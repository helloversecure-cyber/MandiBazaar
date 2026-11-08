import { redirect } from "next/navigation";

/**
 * Old search URL. Search now lives on the product list so it has the same filters,
 * sorting and pagination (QA R2): /search?q=daal → /products?q=daal (all params kept).
 * /search with no query opens the product list with the search box focused.
 */
export default function SearchPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else if (v != null) params.set(k, v);
  }
  if (!params.get("q")?.trim()) {
    params.delete("q");
    params.set("focus", "search");
  }
  redirect(`/products?${params.toString()}`);
}
