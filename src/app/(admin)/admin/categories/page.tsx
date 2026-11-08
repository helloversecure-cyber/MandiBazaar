"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { categorySchema } from "@/lib/validators/schemas";
import { zCategoryName } from "@/lib/validators/pk";
import {
  CATEGORY_IMAGE_REQUIRED_MSG,
  duplicateCategoryMessage,
  findDuplicateCategory,
} from "@/lib/catalog/category-rules";

type Category = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  liveProductCount?: number;
  _count?: { products: number };
};

const PAGE_SIZE = 25;
const FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "noimage", label: "Missing image" },
] as const;

export default function AdminCategoriesPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const createFe = useFieldErrors();
  const editFe = useFieldErrors();

  const [items, setItems] = useState<Category[]>([]);
  const [all, setAll] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [createActive, setCreateActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const loadAll = useCallback(() => {
    fetch("/api/admin?resource=categories")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setAll(d.data.items || []);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ resource: "categories", page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      if (filter) params.set("filter", filter);
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load categories");
        return;
      }
      setItems(d.data.items || []);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
      setActiveCount(d.data.activeCount ?? null);
    } catch {
      if (my === reqId.current) toast.error("Could not load categories. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function refresh() {
    void load();
    loadAll();
  }

  async function create() {
    const values = { name, imageUrl: imageUrl.trim(), isActive: createActive, sortOrder: 0 };
    if (!createFe.check(categorySchema, values)) return;
    const dup = findDuplicateCategory(name, all);
    if (dup) {
      createFe.setErrors({ name: duplicateCategoryMessage(dup) });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "category", data: values }),
      });
      const data = await res.json();
      if (!data.success) {
        createFe.fromResponse(data);
        return;
      }
      createFe.clear();
      toast.success(`Category "${data.data.name}" created${data.data.isActive ? "" : " (inactive)"}`);
      setName("");
      setImageUrl("");
      refresh();
    } catch {
      createFe.setFormError("Could not create the category. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Category) {
    const activating = !c.isActive;
    if (activating && !c.imageUrl) {
      toast.error(CATEGORY_IMAGE_REQUIRED_MSG);
      startEdit(c);
      return;
    }
    const products = c._count?.products ?? 0;
    const r = await confirm({
      title: activating ? `Activate ${c.name}?` : `Deactivate ${c.name}?`,
      message: activating
        ? "It will appear in Shop by category and store owners can list products in it."
        : `It will be hidden from Shop by category and store owners can't pick it for new products. ${products} product(s) use this category and stay in it.`,
      confirmLabel: activating ? "Activate" : "Deactivate",
      tone: activating ? "default" : "danger",
    });
    if (!r.confirmed) return;
    setBusyId(c.id);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "category", id: c.id, data: { isActive: activating } }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Update failed");
        return;
      }
      toast.success(`${c.name} ${activating ? "activated" : "deactivated"}`);
      refresh();
    } catch {
      toast.error("Update failed. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditImageUrl(c.imageUrl || "");
    editFe.clear();
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditImageUrl("");
    editFe.clear();
  }

  async function saveEdit(c: Category) {
    const errors: Record<string, string> = {};
    const n = zCategoryName.safeParse(editName);
    if (!n.success) errors.name = n.error.issues[0]?.message || "Invalid name";
    else {
      const dup = findDuplicateCategory(n.data, all, c.id);
      if (dup) errors.name = duplicateCategoryMessage(dup);
    }
    if (c.isActive && !editImageUrl.trim()) errors.imageUrl = CATEGORY_IMAGE_REQUIRED_MSG;
    if (Object.keys(errors).length) {
      editFe.setErrors(errors);
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "category",
          id: c.id,
          data: { name: editName, imageUrl: editImageUrl.trim() },
        }),
      });
      const data = await res.json();
      if (!data.success) {
        editFe.fromResponse(data);
        return;
      }
      toast.success("Category updated");
      cancelEdit();
      refresh();
    } catch {
      editFe.setFormError("Could not save. Check your connection.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Categories</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-subtle">
        Active categories appear for store owners when they create products, and as tiles in Shop by category. A
        category needs a real image before it can be activated.
        {activeCount != null ? ` ${activeCount} active now.` : ""}
      </p>

      <div className="mt-6 max-w-xl space-y-4 rounded-2xl border border-line bg-card p-5 shadow-card">
        <h2 className="text-lg font-bold text-ink">Add category</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Category name</span>
          <input
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              createFe.clear("name");
            }}
            placeholder="e.g. Daal & Pulses"
            aria-invalid={createFe.has("name")}
            className={inputClass(createFe.has("name"))}
          />
          <FieldError message={createFe.get("name")} />
        </label>

        <div>
          <ImageUploadField
            label="Category image"
            value={imageUrl}
            onChange={(v) => {
              setImageUrl(v);
              createFe.clear("imageUrl");
            }}
            folder="categories"
            required={createActive}
            hint="Square or landscape photo works best (shown on homepage Shop by category)"
          />
          <FieldError message={createFe.get("imageUrl")} />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={createActive}
            onChange={(e) => {
              setCreateActive(e.target.checked);
              createFe.clear("imageUrl");
            }}
          />
          Active (show in the shop now — needs an image)
        </label>

        <FormError message={createFe.formError} />
        <Button type="button" onClick={() => void create()} disabled={saving}>
          {saving ? "Saving…" : "Add category"}
        </Button>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs ${
                filter === f.key ? "bg-brand-600 text-white" : "bg-brand-50 dark:bg-brand-500/10 text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search categories…"
          aria-label="Search categories"
          className="w-full rounded-full border px-4 py-2 text-sm sm:w-64"
        />
      </div>

      {!loading && items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-card px-4 py-6 text-sm text-ink-subtle">
          {query || filter ? `No categories match${query ? ` "${query}"` : " this filter"}.` : "No categories yet."}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((c) => (
            <div key={c.id} className="rounded-2xl bg-card px-4 py-3 shadow-card">
              {editingId === c.id ? (
                <div className="space-y-3">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-ink">Name</span>
                    <input
                      value={editName}
                      maxLength={40}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        editFe.clear("name");
                      }}
                      aria-invalid={editFe.has("name")}
                      className={inputClass(editFe.has("name"), "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2")}
                    />
                    <FieldError message={editFe.get("name")} />
                  </label>
                  <div>
                    <ImageUploadField
                      label="Category image"
                      value={editImageUrl}
                      onChange={(v) => {
                        setEditImageUrl(v);
                        editFe.clear("imageUrl");
                      }}
                      folder="categories"
                      required
                      hint="The image customers see on the homepage"
                    />
                    <FieldError message={editFe.get("imageUrl") || editFe.get("isActive")} />
                  </div>
                  <FormError message={editFe.formError} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={editSaving} onClick={() => void saveEdit(c)}>
                      {editSaving ? "Saving…" : "Save"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-brand-50 dark:bg-brand-500/10 ring-1 ring-line">
                    {c.imageUrl ? (
                      <Image src={c.imageUrl} alt={c.name} fill className="object-cover" sizes="56px" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-1 text-center text-[9px] font-semibold text-amber-700">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 font-bold uppercase ${
                          c.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-ink-muted"
                        }`}
                      >
                        {c.isActive ? "Active" : "Inactive"}
                      </span>
                      {!c.imageUrl && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold uppercase text-amber-800">
                          Missing image
                        </span>
                      )}
                      <span className="text-ink-subtle">
                        {c._count?.products ?? 0} product(s)
                        {c.liveProductCount != null ? ` · ${c.liveProductCount} live` : ""} · /{c.slug}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-brand-50 dark:bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-ink hover:bg-app"
                      onClick={() => startEdit(c)}
                    >
                      {c.imageUrl ? "Edit" : "Add image"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      className="text-sm text-leaf-600 disabled:opacity-50"
                      title={!c.isActive && !c.imageUrl ? CATEGORY_IMAGE_REQUIRED_MSG : undefined}
                      onClick={() => void toggle(c)}
                    >
                      {c.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="categories"
      />
    </div>
  );
}
