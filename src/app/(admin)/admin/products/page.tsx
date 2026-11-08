"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { MultiImageUploadField } from "@/components/ui/MultiImageUploadField";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";

type ChangeRow = {
  field: string;
  label: string;
  from: string | number | null | string[];
  to: string | number | null | string[];
};

type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  salePrice: number | null;
  stockQuantity: number;
  availableStock: number;
  status: string;
  moderationNote: string | null;
  hasPendingChanges: boolean;
  pendingChangesAt: string | null;
  changeRows: ChangeRow[];
  createdAt: string;
  category: { name: string };
  store?: { id: string; name: string };
  images?: { url: string }[];
};

type StoreOption = { id: string; name: string; status?: string };

const emptyForm = {
  name: "",
  sku: "",
  categoryId: "",
  storeId: "",
  price: "",
  salePrice: "",
  unit: "1kg",
  stockQuantity: "50",
  shortDescription: "",
  status: "ACTIVE",
};

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "DRAFT", label: "Pending review" },
  { key: "ACTIVE", label: "Active" },
  { key: "INACTIVE", label: "Inactive" },
  { key: "ARCHIVED", label: "Archived" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Pending review",
  ACTIVE: "Active",
  INACTIVE: "Inactive / declined",
  ARCHIVED: "Archived",
};

const PAGE_SIZE = 25;
const REASON = { required: true, minLength: 5, maxLength: 500 } as const;

function fmtValue(field: string, v: ChangeRow["from"]) {
  if (v == null || v === "") return <span className="text-ink-subtle">—</span>;
  if (Array.isArray(v)) {
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((url, i) => (
          <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- admin comparison thumbs */}
            <img src={url} alt="" className="h-10 w-10 rounded object-cover ring-1 ring-line" />
          </a>
        ))}
      </span>
    );
  }
  if (field === "price" || field === "salePrice") return formatCurrency(Number(v));
  const text = String(v);
  return <span className="whitespace-pre-line break-words">{text.length > 300 ? `${text.slice(0, 300)}…` : text}</span>;
}

export default function AdminProductsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("DRAFT");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [matchesInAll, setMatchesInAll] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
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
    setListLoading(true);
    try {
      const params = new URLSearchParams({ resource: "products", page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      if (statusFilter) params.set("status", statusFilter);
      if (storeFilter) params.set("storeId", storeFilter);
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load products");
        return;
      }
      setItems(d.data.items);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
      setMatchesInAll(d.data.matchesInAll ?? null);
    } catch {
      if (my === reqId.current) toast.error("Could not load products. Check your connection.");
    } finally {
      if (my === reqId.current) setListLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, statusFilter, storeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin?resource=categories")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCategories(d.data.items);
      })
      .catch(() => {});
    // Every store (not capped at 50) for the filter and the create form
    fetch("/api/stores?options=1")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setStores(d.data.items || []);
      })
      .catch(() => {});
  }, []);

  const approvedStores = stores.filter((s) => !s.status || s.status === "APPROVED");

  function openForm() {
    setMsg("");
    setImageUrls([]);
    setForm((f) => ({
      ...emptyForm,
      storeId: f.storeId || approvedStores[0]?.id || "",
      categoryId: categories[0]?.id || "",
    }));
    setShowForm(true);
  }

  function switchTab(key: string) {
    setStatusFilter(key);
    setPage(1);
  }

  async function send(method: "PATCH" | "DELETE", body: Record<string, unknown>, id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function approveProduct(p: Product) {
    const r = await confirm({
      title: `Approve ${p.name}?`,
      message: `It goes live in the shop immediately at ${formatCurrency(p.salePrice || p.price)}.`,
      confirmLabel: "Approve product",
    });
    if (!r.confirmed) return;
    const data = await send("PATCH", { resource: "product", id: p.id, data: { action: "REVIEW", decision: "APPROVED" } }, p.id);
    if (!data) return;
    toast.success(`${p.name} approved — now live in the shop`, {
      action: { label: "View active", onClick: () => switchTab("ACTIVE") },
    });
    void load();
  }

  async function declineProduct(p: Product) {
    const r = await confirm({
      title: `Decline ${p.name}?`,
      message: "It won't be shown in the shop. The store owner sees your reason.",
      confirmLabel: "Decline product",
      tone: "danger",
      reason: { label: "Reason (shown to the store owner)", placeholder: "e.g. Photos don't show the product", ...REASON },
    });
    if (!r.confirmed) return;
    const data = await send(
      "PATCH",
      { resource: "product", id: p.id, data: { action: "REVIEW", decision: "REJECTED", reason: r.reason } },
      p.id
    );
    if (!data) return;
    toast.success(`${p.name} declined`, { action: { label: "View inactive", onClick: () => switchTab("INACTIVE") } });
    void load();
  }

  async function approveChanges(p: Product) {
    const r = await confirm({
      title: `Approve changes to ${p.name}?`,
      message: (
        <ul className="list-disc space-y-1 pl-5">
          {p.changeRows.map((c) => (
            <li key={c.field}>
              {c.label}
              {c.field === "price" || c.field === "salePrice"
                ? `: ${c.from == null ? "—" : formatCurrency(Number(c.from))} → ${c.to == null ? "—" : formatCurrency(Number(c.to))}`
                : ""}
            </li>
          ))}
          <li>The new version goes live in the shop immediately. Existing orders keep their price.</li>
        </ul>
      ),
      confirmLabel: "Approve changes",
    });
    if (!r.confirmed) return;
    const data = await send("PATCH", { resource: "product", id: p.id, data: { action: "APPROVE_CHANGES" } }, p.id);
    if (!data) return;
    toast.success(`Changes to ${p.name} approved — now live`);
    void load();
  }

  async function declineChanges(p: Product) {
    const r = await confirm({
      title: `Decline changes to ${p.name}?`,
      message: "The approved version stays live in the shop. The store owner sees your reason.",
      confirmLabel: "Decline changes",
      tone: "danger",
      reason: { label: "Reason (shown to the store owner)", placeholder: "e.g. Price increase is too large", ...REASON },
    });
    if (!r.confirmed) return;
    const data = await send(
      "PATCH",
      { resource: "product", id: p.id, data: { action: "DECLINE_CHANGES", reason: r.reason } },
      p.id
    );
    if (!data) return;
    toast.success(`Changes to ${p.name} declined`);
    void load();
  }

  async function archive(p: Product) {
    const r = await confirm({
      title: `Archive ${p.name}?`,
      message: "Customers will no longer see it. You can undo for a few seconds after archiving.",
      confirmLabel: "Archive product",
      tone: "danger",
      reason: { label: "Reason (shown to the store owner)", placeholder: "e.g. Duplicate listing", ...REASON },
    });
    if (!r.confirmed) return;
    const data = await send("DELETE", { resource: "product", id: p.id, soft: true, reason: r.reason }, p.id);
    if (!data) return;
    const previousStatus = String(data.previousStatus || p.status);
    void load();
    toast.success(`${p.name} archived`, {
      durationMs: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            const undone = await send(
              "PATCH",
              { resource: "product", id: p.id, data: { action: "RESTORE_STATUS", status: previousStatus } },
              p.id
            );
            if (undone) {
              toast.info(`${p.name} restored`);
              void load();
            }
          })();
        },
      },
    });
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!form.storeId) {
      setMsg("Please select a store");
      return;
    }
    if (!imageUrls.length) {
      setMsg("Add at least one product photo");
      return;
    }
    const price = parseFloat(form.price);
    const salePrice = form.salePrice ? parseFloat(form.salePrice) : null;
    if (!Number.isFinite(price) || price < 1) {
      setMsg("Regular price must be at least Rs. 1");
      return;
    }
    if (salePrice != null && (salePrice < 1 || salePrice >= price)) {
      setMsg("Deal price must be lower than regular price");
      return;
    }

    setLoading(true);
    const { storeId, ...productData } = form;
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "product",
          storeId,
          data: {
            ...productData,
            description: form.shortDescription || undefined,
            price,
            salePrice,
            stockQuantity: parseInt(form.stockQuantity, 10),
            isOrganic: true,
            isFarmProduct: true,
            tags: [],
          },
          images: imageUrls.slice(0, 5).map((url) => ({ url })),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMsg(data.error || "Failed");
        return;
      }
      setShowForm(false);
      setImageUrls([]);
      toast.success("Product created");
      void load();
    } catch {
      setMsg("Could not create the product. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const tabLabel = STATUS_TABS.find((t) => t.key === statusFilter)?.label || "this tab";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Products</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Approve store-submitted products and changes to live products before customers see them.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, SKU or store…"
            aria-label="Search products"
            className="min-w-0 flex-1 rounded-full border px-4 py-2 text-sm sm:w-64 sm:flex-none"
          />
          <select
            value={storeFilter}
            onChange={(e) => {
              setStoreFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by store"
            className="min-w-0 max-w-full rounded-full border px-3 py-2 text-sm"
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status && s.status !== "APPROVED" ? ` (${s.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={openForm}
            className="rounded-full bg-brand-600 px-4 py-2 text-sm text-white"
          >
            Add product
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key || "all"}
            type="button"
            role="tab"
            aria-selected={statusFilter === t.key}
            onClick={() => switchTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs ${
              statusFilter === t.key ? "bg-brand-600 text-white" : "bg-brand-50 dark:bg-brand-500/10 text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-brand-50 dark:bg-brand-500/10">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!listLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">
                  {query ? (
                    <>
                      No products match &quot;{query}&quot; in {tabLabel}.
                      {statusFilter && matchesInAll ? (
                        <>
                          {" "}
                          {matchesInAll} match{matchesInAll === 1 ? "es" : ""} in All —{" "}
                          <button type="button" className="font-semibold text-leaf-700 underline" onClick={() => switchTab("")}>
                            show All
                          </button>
                        </>
                      ) : statusFilter ? (
                        " No match in other tabs either."
                      ) : null}
                    </>
                  ) : statusFilter === "DRAFT" ? (
                    "No products or changes waiting for approval"
                  ) : (
                    "No products found"
                  )}
                </td>
              </tr>
            )}
            {listLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">
                  Loading products…
                </td>
              </tr>
            )}
            {items.map((p) => {
              const busy = busyId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className="border-t align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.images?.[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- tiny admin table thumb; URL may be any CDN
                          <img src={p.images[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/10 text-[10px] text-ink-subtle">
                            No photo
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-ink-subtle">
                            {p.category?.name} · {p.sku}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{p.store?.name || "—"}</td>
                    <td className="px-4 py-3">{formatCurrency(p.salePrice || p.price)}</td>
                    <td className="px-4 py-3">
                      {p.availableStock} avail / {p.stockQuantity}
                    </td>
                    <td className="px-4 py-3">
                      {p.status === "DRAFT" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                          Pending review
                        </span>
                      ) : (
                        <span className="text-xs">{STATUS_LABEL[p.status] || p.status}</span>
                      )}
                      {p.hasPendingChanges && (
                        <span className="mt-1 block w-fit rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800">
                          Changes to review
                        </span>
                      )}
                      {p.moderationNote && (
                        <p className="mt-1 max-w-[14rem] text-[11px] text-red-700">Note: {p.moderationNote}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.status === "DRAFT" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-full bg-leaf-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => void approveProduct(p)}
                            >
                              {busy ? "…" : "Approve"}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 disabled:opacity-50"
                              onClick={() => void declineProduct(p)}
                            >
                              Decline
                            </button>
                          </>
                        )}
                        {p.status !== "ARCHIVED" && (
                          <button
                            type="button"
                            disabled={busy}
                            className="text-xs text-red-600 disabled:opacity-50"
                            onClick={() => void archive(p)}
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {p.hasPendingChanges && (
                    <tr className="bg-sky-50/50">
                      <td colSpan={6} className="px-4 pb-4 pt-1">
                        <div className="rounded-2xl border border-sky-100 bg-card p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
                            Store changed this live product
                            {p.pendingChangesAt ? ` on ${new Date(p.pendingChangesAt).toLocaleString()}` : ""} — the
                            approved version stays live until you decide
                          </p>
                          {p.changeRows.length ? (
                            <table className="mt-2 w-full text-left text-xs">
                              <thead>
                                <tr className="text-ink-subtle">
                                  <th className="py-1 pr-3 font-semibold">Field</th>
                                  <th className="py-1 pr-3 font-semibold">Now (live)</th>
                                  <th className="py-1 font-semibold">Requested</th>
                                </tr>
                              </thead>
                              <tbody>
                                {p.changeRows.map((c) => (
                                  <tr key={c.field} className="border-t border-sky-50 align-top">
                                    <td className="py-1.5 pr-3 font-medium">{c.label}</td>
                                    <td className="py-1.5 pr-3 text-ink-muted">{fmtValue(c.field, c.from)}</td>
                                    <td className="py-1.5 font-semibold text-ink">{fmtValue(c.field, c.to)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="mt-2 text-xs text-ink-subtle">
                              The submitted values are the same as the live product.
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-full bg-leaf-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => void approveChanges(p)}
                            >
                              Approve changes
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 disabled:opacity-50"
                              onClick={() => void declineChanges(p)}
                            >
                              Decline changes
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="products"
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-700/40 p-4">
          <form
            onSubmit={createProduct}
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-3xl bg-card p-6"
          >
            <h2 className="font-display text-xl">New product</h2>
            <p className="mt-1 text-xs text-ink-subtle">
              Upload real product photos — no placeholder images.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <FieldLabel required>Store</FieldLabel>
                <select
                  required
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.storeId}
                  onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                >
                  <option value="">Select store</option>
                  {approvedStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel required>Name</FieldLabel>
                <input
                  required
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel required>SKU</FieldLabel>
                <input
                  required
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel required>Category</FieldLabel>
                <select
                  required
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm({ ...form, categoryId: e.target.value })
                  }
                >
                  <option value="">Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <MultiImageUploadField
                label="Product photos"
                values={imageUrls}
                onChange={setImageUrls}
                folder="products"
                required
                hint="Add up to 5 photos of this product (JPG/PNG/WebP)."
              />

              <div>
                <FieldLabel required>Price (Rs.)</FieldLabel>
                <input
                  required
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel>Deal price (optional)</FieldLabel>
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.salePrice}
                  onChange={(e) =>
                    setForm({ ...form, salePrice: e.target.value })
                  }
                />
              </div>
              <div>
                <FieldLabel required>Unit</FieldLabel>
                <input
                  required
                  placeholder="e.g. 1kg"
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </div>
              <div>
                <FieldLabel required>Stock</FieldLabel>
                <input
                  required
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.stockQuantity}
                  onChange={(e) =>
                    setForm({ ...form, stockQuantity: e.target.value })
                  }
                />
              </div>
              <div>
                <FieldLabel>Short description</FieldLabel>
                <textarea
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.shortDescription}
                  onChange={(e) =>
                    setForm({ ...form, shortDescription: e.target.value })
                  }
                />
              </div>
            </div>
            {msg && (
              <p
                className={`mt-3 text-sm ${
                  msg.toLowerCase().includes("created")
                    ? "text-leaf-600"
                    : "text-red-600"
                }`}
              >
                {msg}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-brand-600 px-5 py-2 text-white disabled:opacity-50"
              >
                {loading ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                className="rounded-full border px-5 py-2"
                onClick={() => {
                  setShowForm(false);
                  setMsg("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
