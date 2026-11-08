"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatCurrency, discountPercent } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { MultiImageUploadField } from "@/components/ui/MultiImageUploadField";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, FormError } from "@/components/ui/FieldError";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import {
  PRODUCT_LIMITS,
  PRODUCT_UNITS,
  PRODUCT_UNIT_LABELS,
  REVIEWED_FIELD_LABELS,
  formatUnit,
  parseUnit,
  percentOff,
  stockBelowReservedError,
  storeProductCreateSchema,
  type ProductUnit,
} from "@/lib/validators/product-rules";
import { plural } from "@/lib/portal/format";
import { ShieldCheck, ShieldAlert, Search, Clock, AlertTriangle } from "lucide-react";

type Store = { id: string; name: string; status: string };
type Category = { id: string; name: string };
type PendingChanges = {
  name?: string;
  categoryId?: string;
  unit?: string;
  description?: string;
  shortDescription?: string;
  price?: number;
  salePrice?: number | null;
  images?: { url: string; sortOrder: number }[];
  submittedAt?: string;
};
type Product = {
  id: string;
  name: string;
  urduName?: string | null;
  price: number;
  salePrice: number | null;
  stockQuantity: number;
  reservedStock?: number;
  status: string;
  isOrganic: boolean;
  freeDelivery: boolean;
  description: string | null;
  shortDescription?: string | null;
  unit?: string;
  categoryId?: string;
  category?: { id: string; name: string } | null;
  store: { name: string };
  images: { url: string }[];
  pendingChanges?: PendingChanges | null;
  moderationNote?: string | null;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "outofstock", label: "Out of stock" },
  { key: "awaiting", label: "Awaiting approval" },
  { key: "review", label: "Changes in review" },
  { key: "declined", label: "Declined" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];
const PAGE_SIZE = 20;

const inputCls = (invalid?: boolean) =>
  `mt-1 w-full rounded-xl border bg-app px-3 py-2.5 text-sm outline-none focus:bg-card ${
    invalid ? "border-red-400 focus:border-red-400" : "border-line focus:border-brand-400"
  }`;

function StoreProductsPage() {
  const searchParams = useSearchParams();
  const editFromQuery = searchParams.get("edit");
  const confirm = useConfirm();
  const toast = useToast();
  const fe = useFieldErrors();

  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [urduName, setUrduName] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [price, setPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [unitSize, setUnitSize] = useState("1");
  const [unitName, setUnitName] = useState<ProductUnit | "">("pc");
  const [legacyUnit, setLegacyUnit] = useState("");
  const [stock, setStock] = useState("10");
  const [categoryId, setCategoryId] = useState("");
  const [useOtherCategory, setUseOtherCategory] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [productType, setProductType] = useState<"organic" | "inorganic">("organic");
  const [freeDelivery, setFreeDelivery] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  /** Current category of the product being edited (kept even if not in the store list). */
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingReserved, setEditingReserved] = useState(0);
  const [editingPending, setEditingPending] = useState<PendingChanges | null>(null);
  const [originalImageUrls, setOriginalImageUrls] = useState<string[]>([]);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyVerdict, setVerifyVerdict] = useState<"" | "verified" | "mismatch" | "unverified" | "unavailable">("");
  const [verifyNote, setVerifyNote] = useState("");
  const [imageAttested, setImageAttested] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // List controls
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const editHandled = useRef(false);

  const loadCategoriesForStore = useCallback(async (sid: string) => {
    if (!sid) {
      setCategories([]);
      return;
    }
    const c = await fetch(
      `/api/store?resource=categories&storeId=${encodeURIComponent(sid)}`,
      { cache: "no-store" }
    ).then((r) => r.json());
    setCategories(c.success && Array.isArray(c.data?.items) ? c.data.items : []);
  }, []);

  const loadStores = useCallback(async () => {
    const s = await fetch("/api/store?resource=stores").then((r) => r.json());
    if (!s.success) return;
    const approved: Store[] = (s.data.items || []).filter((x: Store) => x.status === "APPROVED");
    setStores(approved);
    const sid = approved[0]?.id || "";
    setStoreId((prev) => prev || sid);
    if (sid) await loadCategoriesForStore(sid);
  }, [loadCategoriesForStore]);

  const loadProducts = useCallback(async () => {
    setListLoading(true);
    try {
      const params = new URLSearchParams({
        resource: "products",
        page: String(page),
        limit: String(PAGE_SIZE),
        filter,
      });
      if (q) params.set("q", q);
      const p = await fetch(`/api/store?${params}`, { cache: "no-store" }).then((r) => r.json());
      if (p.success) {
        setProducts(p.data.items || []);
        setTotalPages(p.data.pagination?.totalPages || 1);
        setTotal(p.data.pagination?.total || 0);
        setCounts(p.data.counts || {});
      }
    } finally {
      setListLoading(false);
    }
  }, [page, filter, q]);

  useEffect(() => {
    void loadStores();
    fetch("/api/products/verify-image")
      .then((r) => r.json())
      .then((d) => setVisionEnabled(Boolean(d?.data?.visionEnabled)))
      .catch(() => setVisionEnabled(false));
  }, [loadStores]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // ?edit=<id> from the dashboard: fetch that product directly (it may not be on page 1)
  useEffect(() => {
    if (!editFromQuery || editHandled.current) return;
    editHandled.current = true;
    fetch(`/api/store?resource=products`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const match = (d?.data?.items || []).find((x: Product) => x.id === editFromQuery);
        if (match) startEdit(match);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFromQuery]);

  function applyUnit(raw: string | undefined) {
    const parsed = parseUnit(raw || "");
    if (parsed) {
      setUnitSize(String(parsed.size));
      setUnitName(parsed.unit);
      setLegacyUnit("");
    } else {
      setUnitSize("1");
      setUnitName("");
      setLegacyUnit(raw || "");
    }
  }

  function startEdit(p: Product) {
    // Show what the store last submitted (pending values) over the live ones.
    const pc = p.pendingChanges || null;
    const urls = (pc?.images
      ? [...pc.images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.url)
      : (p.images || []).map((img) => img.url)
    ).filter(Boolean);
    fe.clear();
    setNotice("");
    setEditingId(p.id);
    setEditingReserved(p.reservedStock || 0);
    setEditingPending(pc);
    setName(pc?.name ?? p.name);
    setUrduName(p.urduName || "");
    const desc = pc?.description ?? p.description ?? "";
    setDescription(desc);
    const sd = pc?.shortDescription ?? p.shortDescription ?? "";
    setShortDescription(sd && sd !== desc.slice(0, PRODUCT_LIMITS.shortDescriptionMax) ? sd : "");
    setPrice(String(pc?.price ?? p.price));
    const sale = pc && pc.salePrice !== undefined ? pc.salePrice : p.salePrice;
    setSalePrice(sale != null ? String(sale) : "");
    applyUnit(pc?.unit ?? p.unit);
    setStock(String(p.stockQuantity));
    setProductType(p.isOrganic ? "organic" : "inorganic");
    setFreeDelivery(Boolean(p.freeDelivery));
    setImageUrls(urls);
    setOriginalImageUrls(urls);
    setVerifyVerdict("");
    setVerifyNote("");
    setImageAttested(urls.length > 0);
    setUseOtherCategory(false);
    setCustomCategoryName("");
    // N4: pre-select the product's current category, even when it isn't in
    // this store's signup list (it is added to the dropdown below).
    const catId = pc?.categoryId ?? p.categoryId ?? p.category?.id ?? "";
    setCategoryId(catId);
    setEditingCategory(
      p.category && p.category.id === catId ? { id: p.category.id, name: p.category.name } : catId ? { id: catId, name: "Current category" } : null
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    fe.clear();
    setEditingId(null);
    setEditingReserved(0);
    setEditingPending(null);
    setEditingCategory(null);
    setName("");
    setUrduName("");
    setDescription("");
    setShortDescription("");
    setPrice("");
    setSalePrice("");
    setImageUrls([]);
    setOriginalImageUrls([]);
    setProductType("organic");
    setFreeDelivery(false);
    setStock("10");
    setUnitSize("1");
    setUnitName("pc");
    setLegacyUnit("");
    setVerifyVerdict("");
    setVerifyNote("");
    setImageAttested(false);
    setUseOtherCategory(false);
    setCustomCategoryName("");
    setCategoryId("");
  }

  function imagesUnchanged() {
    if (imageUrls.length !== originalImageUrls.length) return false;
    return imageUrls.every((url, i) => url === originalImageUrls[i]);
  }

  const unitValue = unitName ? formatUnit(Number(unitSize) || 0, unitName) : "";

  /** Same rules as the server (product-rules.ts). Returns true when OK. */
  function validateForm(): boolean {
    const values = {
      name,
      urduName,
      description,
      shortDescription,
      price: price.trim(),
      salePrice: salePrice.trim() === "" ? null : salePrice.trim(),
      stockQuantity: stock.trim(),
      unit: unitValue,
    };
    const ok = fe.check(storeProductCreateSchema, values);
    const extra: Record<string, string> = {};
    if (!unitName) extra.unit = "Choose a unit from the list";
    if (useOtherCategory) {
      if (customCategoryName.trim().length < 2) extra.customCategoryName = "Type your category name (2–40 characters)";
    } else if (!categoryId) {
      extra.categoryId = categories.length
        ? "Please select a category"
        : "No categories for your store yet — choose Others to request one";
    }
    if (!imageUrls.length) extra.images = "Add at least one product photo";
    if (editingId) {
      const stockErr = stockBelowReservedError(Number(stock), editingReserved);
      if (stockErr) extra.stockQuantity = stockErr;
    }
    if (Object.keys(extra).length) {
      fe.setErrors((prev) => ({ ...extra, ...prev }));
      fe.setFormError("Please fix the highlighted fields");
      return false;
    }
    return ok;
  }

  function onImagesChange(urls: string[]) {
    setImageUrls(urls);
    setVerifyVerdict("");
    setVerifyNote("");
    setImageAttested(false);
    fe.clear("images");
  }

  /** Real photo check — only when an image model is configured (QA N8). */
  async function checkPhotos(): Promise<"verified" | "mismatch" | "unverified"> {
    setVerifying(true);
    try {
      const categoryName =
        categories.find((c) => c.id === categoryId)?.name ||
        (editingCategory?.id === categoryId ? editingCategory?.name : undefined) ||
        (useOtherCategory ? customCategoryName : undefined);
      const res = await fetch("/api/products/verify-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: name, description, categoryName, imageUrls }),
      });
      const data = await res.json();
      if (!data.success) {
        setVerifyVerdict("unverified");
        setVerifyNote("Couldn't verify these photos automatically — an admin will review the photos.");
        return "unverified";
      }
      const verdict = data.data.verdict as "verified" | "mismatch" | "unverified" | "unavailable";
      setVerifyVerdict(verdict);
      setVerifyNote(data.data.summary || "");
      if (verdict === "unavailable") {
        setVisionEnabled(false);
        return "unverified";
      }
      return verdict;
    } catch {
      setVerifyVerdict("unverified");
      setVerifyNote("Couldn't verify these photos automatically — an admin will review the photos.");
      return "unverified";
    } finally {
      setVerifying(false);
    }
  }

  async function addOrUpdateProduct(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");
    if (!validateForm()) return;

    const photosChanged = !(editingId && imagesUnchanged());
    if (photosChanged) {
      if (!imageAttested) {
        fe.setErrors((prev) => ({
          ...prev,
          images: "Tick the box to confirm these photos show this exact product",
        }));
        fe.setFormError("Please fix the highlighted fields");
        return;
      }
      if (visionEnabled) {
        const verdict = await checkPhotos();
        if (verdict === "mismatch") {
          fe.setErrors((prev) => ({
            ...prev,
            images: "These photos don't match this product. Replace the photos listed above.",
          }));
          fe.setFormError("Please fix the highlighted fields");
          return;
        }
        // "unverified" is allowed: an admin reviews the photos before they go live.
      }
    }

    setLoading(true);
    const isOrganic = productType === "organic";
    const payload = {
      name: name.trim(),
      urduName: urduName.trim(),
      description: description.trim(),
      shortDescription: shortDescription.trim(),
      price: Number(price),
      salePrice: salePrice.trim() ? Number(salePrice) : null,
      unit: unitValue,
      stockQuantity: Number(stock),
      categoryId: useOtherCategory ? undefined : categoryId,
      customCategoryName: useOtherCategory ? customCategoryName.trim() : undefined,
      isOrganic,
      freeDelivery,
      imageUrls,
    };

    try {
      if (editingId) {
        const res = await fetch("/api/store", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "UPDATE_PRODUCT", productId: editingId, ...payload }),
        });
        const data = await res.json();
        if (!data.success) {
          fe.fromResponse(data);
          return;
        }
        const message = data.data?.message || "Product updated";
        if (data.data?.pendingReview) toast.info(message);
        else toast.success(message);
        setNotice(message);
        resetForm();
        void loadProducts();
        return;
      }

      if (!storeId) {
        fe.setFormError("Please select a store");
        return;
      }
      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, ...payload, isFarmProduct: isOrganic, status: "DRAFT" }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        return;
      }
      const message =
        data.data?.message ||
        "Product submitted for MandiBazaar approval. It goes live after approval.";
      toast.success(message);
      setNotice(message);
      resetForm();
      setPage(1);
      void loadProducts();
    } catch {
      fe.setFormError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(p: Product) {
    if (p.status === "DRAFT") {
      toast.info("This product is waiting for MandiBazaar approval.");
      return;
    }
    const next = p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const res = await fetch("/api/store", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "UPDATE_PRODUCT", productId: p.id, status: next }),
    });
    const data = await res.json();
    if (!data.success) {
      toast.error(data.error || "Failed to update status");
      return;
    }
    toast.success(`Product ${next === "ACTIVE" ? "activated" : "deactivated"}`);
    void loadProducts();
  }

  async function removeProduct(p: Product) {
    const { confirmed } = await confirm({
      title: `Delete “${p.name}”?`,
      message: "It will be removed from your store and hidden from customers. Past orders stay safe.",
      confirmLabel: "Delete product",
      tone: "danger",
    });
    if (!confirmed) return;
    setDeletingId(p.id);
    try {
      const res = await fetch("/api/store", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE_PRODUCT", productId: p.id }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Could not delete product");
        return;
      }
      if (editingId === p.id) resetForm();
      toast.success("Product deleted");
      await loadProducts();
    } finally {
      setDeletingId(null);
    }
  }

  const categoryOptions: Category[] =
    editingCategory && !categories.some((c) => c.id === editingCategory.id)
      ? [editingCategory, ...categories]
      : categories;
  const priceNum = Number(price);
  const saleNum = Number(salePrice);
  const livePct = salePrice && price ? percentOff(priceNum, saleNum) : 0;
  const pendingKeys = editingPending
    ? (Object.keys(REVIEWED_FIELD_LABELS) as (keyof typeof REVIEWED_FIELD_LABELS)[]).filter(
        (k) => editingPending[k] !== undefined
      )
    : [];

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-ink">Products</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Add products with photo, description, and organic/inorganic type. To run
        a discount, set a{" "}
        <Link href="/store-portal/deals" className="font-medium text-deal-600 underline">
          Deal
        </Link>{" "}
        or enter a deal price below.
      </p>

      <form
        onSubmit={addOrUpdateProduct}
        noValidate
        className="mt-6 grid gap-4 rounded-2xl border border-line bg-card p-5 shadow-card md:grid-cols-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2">
          <h2 className="text-lg font-bold text-ink">
            {editingId ? "Edit product" : "Add product"}
          </h2>
          {editingId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={deletingId === editingId}
              onClick={() => {
                const p = products.find((x) => x.id === editingId);
                if (p) void removeProduct(p);
              }}
            >
              {deletingId === editingId ? "Deleting…" : "Delete product"}
            </Button>
          )}
        </div>

        {editingId && (
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-900 md:col-span-2">
            Changes to the name, category, unit, description or photos — and price
            changes of more than 20% — are checked by MandiBazaar before customers
            see them. Stock, small price changes and the organic / free-delivery
            options update straight away.
            {pendingKeys.length > 0 && (
              <p className="mt-1 font-semibold">
                Waiting for review now: {pendingKeys.map((k) => REVIEWED_FIELD_LABELS[k]).join(", ")}.
                The form shows the values you sent.
              </p>
            )}
          </div>
        )}

        {!editingId && (
          <div>
            <FieldLabel required>Store</FieldLabel>
            {stores.length <= 1 ? (
              <p className="mt-1 rounded-xl border border-line bg-app px-3 py-2.5 text-sm font-medium text-ink">
                {stores[0]?.name || "No approved store yet"}
              </p>
            ) : (
              <select
                id="product-store"
                className={inputCls()}
                value={storeId}
                onChange={(e) => {
                  const sid = e.target.value;
                  setStoreId(sid);
                  setCategoryId("");
                  setUseOtherCategory(false);
                  setCustomCategoryName("");
                  void loadCategoriesForStore(sid);
                }}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {stores.length === 0 && (
              <p className="mt-1 text-xs text-deal-600">
                Your store must be approved before you can add products.
              </p>
            )}
          </div>
        )}

        <div className={editingId ? "md:col-span-2" : undefined}>
          <FieldLabel required htmlFor="product-category">Category</FieldLabel>
          <select
            id="product-category"
            className={inputCls(fe.has("categoryId"))}
            value={useOtherCategory ? "__others__" : categoryId}
            onChange={(e) => {
              const v = e.target.value;
              fe.clear("categoryId");
              fe.clear("customCategoryName");
              if (v === "__others__") {
                setUseOtherCategory(true);
                return;
              }
              setUseOtherCategory(false);
              setCustomCategoryName("");
              setCategoryId(v);
            }}
          >
            <option value="">
              {categoryOptions.length === 0
                ? "Select Others or wait for MandiBazaar categories"
                : "Select a category"}
            </option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__others__">Others (request new category)</option>
          </select>
          <FieldError message={fe.get("categoryId")} />
          {useOtherCategory && (
            <>
              <input
                className={inputCls(fe.has("customCategoryName")) + " mt-2"}
                placeholder="Type your category name"
                maxLength={40}
                value={customCategoryName}
                onChange={(e) => {
                  setCustomCategoryName(e.target.value);
                  fe.clear("customCategoryName");
                }}
              />
              <FieldError message={fe.get("customCategoryName")} />
            </>
          )}
          <p className="mt-1 text-xs text-ink-subtle">
            Shows categories you selected at signup that MandiBazaar has
            created. Use Others if yours is missing — new products need Super
            Admin approval before going live.
          </p>
        </div>

        <div>
          <FieldLabel required htmlFor="product-name">Product name</FieldLabel>
          <input
            id="product-name"
            className={inputCls(fe.has("name"))}
            placeholder="e.g. Organic Tomato"
            maxLength={PRODUCT_LIMITS.nameMax}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              fe.clear("name");
            }}
          />
          <FieldError message={fe.get("name")} />
          <p className="mt-1 text-[11px] text-ink-subtle">{name.trim().length}/{PRODUCT_LIMITS.nameMax}</p>
        </div>

        <div>
          <FieldLabel htmlFor="product-urdu-name">Urdu name (optional)</FieldLabel>
          <input
            id="product-urdu-name"
            dir="auto"
            className={inputCls(fe.has("urduName"))}
            placeholder="مثلاً ٹماٹر"
            maxLength={PRODUCT_LIMITS.urduNameMax}
            value={urduName}
            onChange={(e) => {
              setUrduName(e.target.value);
              fe.clear("urduName");
            }}
          />
          <FieldError message={fe.get("urduName")} />
          <p className="mt-1 text-[11px] text-ink-subtle">Helps customers who search in Urdu.</p>
        </div>

        <div className="md:col-span-2">
          <FieldLabel required htmlFor="product-description">Description</FieldLabel>
          <textarea
            id="product-description"
            className={inputCls(fe.has("description")) + " min-h-[100px]"}
            placeholder="Ingredients, quality, packaging, etc."
            maxLength={PRODUCT_LIMITS.descriptionMax}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              fe.clear("description");
            }}
          />
          <FieldError message={fe.get("description")} />
          <p className="mt-1 text-[11px] text-ink-subtle">
            {description.trim().length}/{PRODUCT_LIMITS.descriptionMax.toLocaleString("en-PK")}
          </p>
        </div>

        <div className="md:col-span-2">
          <FieldLabel htmlFor="product-short-description">Short description (optional)</FieldLabel>
          <input
            id="product-short-description"
            className={inputCls(fe.has("shortDescription"))}
            placeholder="One line shown on product cards — leave empty to use the start of the description"
            maxLength={PRODUCT_LIMITS.shortDescriptionMax}
            value={shortDescription}
            onChange={(e) => {
              setShortDescription(e.target.value);
              fe.clear("shortDescription");
            }}
          />
          <FieldError message={fe.get("shortDescription")} />
        </div>

        <div className="md:col-span-2 space-y-3">
          <MultiImageUploadField
            label="Product photos"
            values={imageUrls}
            onChange={onImagesChange}
            folder="products"
            required
            hint="Add up to 5 real photos of this product (JPG/PNG/WebP). Wrong or unrelated photos will be rejected."
          />

          <div className="rounded-xl border border-line bg-app p-4">
            {visionEnabled && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={verifying || !imageUrls.length || !name.trim()}
                  onClick={() => void checkPhotos()}
                >
                  {verifying ? "Checking photos…" : "Check photos match product"}
                </Button>
                {verifyVerdict === "verified" && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Photos match
                  </span>
                )}
                {verifyVerdict === "mismatch" && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Photos don&apos;t match
                  </span>
                )}
                {verifyVerdict === "unverified" && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Couldn&apos;t verify
                  </span>
                )}
              </div>
            )}
            {verifyNote && (
              <p
                className={`mb-3 text-xs ${
                  verifyVerdict === "mismatch" ? "font-medium text-red-600" : "text-ink-muted"
                }`}
              >
                {verifyNote}
              </p>
            )}
            <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand-600"
                checked={imageAttested}
                onChange={(e) => {
                  setImageAttested(e.target.checked);
                  fe.clear("images");
                }}
              />
              <span>
                <strong>Confirm photos:</strong> I confirm these photos show this{" "}
                <strong>exact product</strong> — not a different item, a stock photo
                of something else, or an unrelated image.
              </span>
            </label>
            <p className="mt-2 text-[11px] text-ink-subtle">
              {visionEnabled
                ? "Photos are also checked automatically when you save. If the check can't decide, an admin reviews the photos."
                : "MandiBazaar reviews product photos before they appear in the shop."}
            </p>
            <FieldError message={fe.get("images")} />
          </div>
        </div>

        <fieldset className="md:col-span-2">
          <legend className="text-sm font-medium text-ink-muted">
            Product type
            <span className="ml-0.5 font-semibold text-red-600" aria-hidden>
              *
            </span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="productType"
                checked={productType === "organic"}
                onChange={() => setProductType("organic")}
                className="accent-brand-600"
              />
              <span className="font-medium text-emerald-700">Organic</span>
              <span className="text-ink-subtle">— natural, chemical-free</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="productType"
                checked={productType === "inorganic"}
                onChange={() => setProductType("inorganic")}
                className="accent-brand-600"
              />
              <span className="font-medium text-ink-muted">Inorganic</span>
              <span className="text-ink-subtle">— processed / conventional</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="text-sm font-medium text-ink-muted">
            Free delivery for customers?
          </legend>
          <p className="mt-1 text-xs text-ink-subtle">
            If Yes, customers get free delivery when their cart only has free-delivery
            products (or when order is Rs. 5,000+).
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="freeDelivery"
                checked={freeDelivery === true}
                onChange={() => setFreeDelivery(true)}
                className="accent-brand-600"
              />
              <span className="font-medium text-emerald-700">Yes</span>
              <span className="text-ink-subtle">— this product includes free delivery</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="freeDelivery"
                checked={freeDelivery === false}
                onChange={() => setFreeDelivery(false)}
                className="accent-brand-600"
              />
              <span className="font-medium text-ink-muted">No</span>
              <span className="text-ink-subtle">— normal delivery fee applies</span>
            </label>
          </div>
        </fieldset>

        <div>
          <FieldLabel required htmlFor="product-price">Regular price (Rs.)</FieldLabel>
          <input
            id="product-price"
            className={inputCls(fe.has("price"))}
            placeholder="e.g. 250"
            type="number"
            inputMode="numeric"
            min={1}
            max={PRODUCT_LIMITS.priceMax}
            step={1}
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              fe.clear("price");
              fe.clear("salePrice");
            }}
          />
          <FieldError message={fe.get("price")} />
          <p className="mt-1 text-[11px] text-ink-subtle">Whole rupees, 1 – 1,000,000</p>
        </div>

        <div>
          <FieldLabel htmlFor="product-sale-price">Deal price (optional)</FieldLabel>
          <input
            id="product-sale-price"
            className={inputCls(fe.has("salePrice"))}
            placeholder="Lower price = shows on Deals"
            type="number"
            inputMode="numeric"
            min={1}
            max={PRODUCT_LIMITS.priceMax}
            step={1}
            value={salePrice}
            onChange={(e) => {
              setSalePrice(e.target.value);
              fe.clear("salePrice");
            }}
          />
          <FieldError message={fe.get("salePrice")} />
          <p className="mt-1 text-xs text-ink-subtle">
            {livePct > 0 ? (
              <span className="font-semibold text-deal-600">{livePct}% off · </span>
            ) : salePrice && saleNum >= priceNum && priceNum > 0 ? (
              <span className="font-semibold text-red-600">Must be lower than the regular price · </span>
            ) : null}
            Or manage deals on the{" "}
            <Link href="/store-portal/deals" className="text-deal-600 underline">
              Deals
            </Link>{" "}
            page.
          </p>
        </div>

        <div>
          <FieldLabel required htmlFor="product-unit-size">Sold per (unit)</FieldLabel>
          <div className="flex gap-2">
            <input
              id="product-unit-size"
              aria-label="Pack size"
              className={inputCls(fe.has("unit")) + " w-24"}
              type="number"
              inputMode="decimal"
              min={0.001}
              max={PRODUCT_LIMITS.packSizeMax}
              step="any"
              value={unitSize}
              onChange={(e) => {
                setUnitSize(e.target.value);
                fe.clear("unit");
              }}
            />
            <select
              id="product-unit"
              aria-label="Unit"
              className={inputCls(fe.has("unit"))}
              value={unitName}
              onChange={(e) => {
                setUnitName(e.target.value as ProductUnit | "");
                fe.clear("unit");
              }}
            >
              <option value="">Choose unit</option>
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {PRODUCT_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
          <FieldError message={fe.get("unit")} />
          <p className="mt-1 text-[11px] text-ink-subtle">
            {unitValue ? `Customers see: Rs. ${price || "…"} / ${unitValue}` : "e.g. 1 kg, 500 g, 12 pc"}
            {legacyUnit && !unitName ? ` · Old unit “${legacyUnit}” — please choose from the list` : ""}
          </p>
        </div>

        <div>
          <FieldLabel required htmlFor="product-stock">Stock quantity</FieldLabel>
          <input
            id="product-stock"
            className={inputCls(fe.has("stockQuantity"))}
            placeholder="How many units available"
            type="number"
            inputMode="numeric"
            min={editingId ? editingReserved : 0}
            max={PRODUCT_LIMITS.stockMax}
            step={1}
            value={stock}
            onChange={(e) => {
              setStock(e.target.value);
              fe.clear("stockQuantity");
            }}
          />
          <FieldError message={fe.get("stockQuantity")} />
          {editingId && editingReserved > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {plural(editingReserved, "unit")} reserved in open/unpaid orders — stock
              cannot go below that.
            </p>
          )}
        </div>

        <div className="space-y-2 md:col-span-2">
          <FormError message={fe.formError} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={loading || verifying || (!editingId && stores.length === 0)}
            >
              {loading || verifying
                ? verifying
                  ? "Checking photos…"
                  : editingId
                    ? "Saving…"
                    : "Creating…"
                : editingId
                  ? "Save changes"
                  : "Create product"}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel edit
              </Button>
            )}
          </div>
          {notice && <p className="text-sm text-brand-700">{notice}</p>}
        </div>
      </form>

      <div className="mt-8 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink">
              Your products ({plural(counts.all ?? total, "product")})
            </h2>
            <p className="text-sm text-ink-subtle">
              Use Edit to change price, stock, photos, or description.
            </p>
          </div>
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQ(qInput.trim());
            }}
          >
            <div className="relative flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <input
                type="search"
                className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
                placeholder="Search name or SKU"
                maxLength={80}
                value={qInput}
                onChange={(e) => {
                  setQInput(e.target.value);
                  if (!e.target.value) {
                    setQ("");
                    setPage(1);
                  }
                }}
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                filter === f.key
                  ? "bg-brand-600 text-white"
                  : "bg-card text-ink-muted ring-1 ring-line"
              }`}
            >
              {f.label}
              {counts[f.key] != null ? ` (${counts[f.key]})` : ""}
            </button>
          ))}
        </div>

        {listLoading && <p className="text-sm text-ink-subtle">Loading your products…</p>}
        {!listLoading && products.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-app px-4 py-10 text-center">
            <p className="text-sm text-ink-muted">
              {q || filter !== "all"
                ? "No products match this search or filter."
                : "You have not added any products yet."}
            </p>
            {!q && filter === "all" && (
              <p className="mt-1 text-xs text-ink-subtle">Fill the form above and tap Create product.</p>
            )}
          </div>
        )}
        {products.map((p) => {
          const hasPending = Boolean(p.pendingChanges);
          return (
            <div
              key={p.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 shadow-card sm:flex-row sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 gap-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {p.images[0]?.url ? (
                    <Image src={p.images[0].url} alt={p.name} fill className="object-cover" sizes="64px" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-subtle">
                      No photo
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{p.name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        p.isOrganic ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-ink-muted"
                      }`}
                    >
                      {p.isOrganic ? "Organic" : "Inorganic"}
                    </span>
                    {p.freeDelivery && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700">
                        Free delivery
                      </span>
                    )}
                    {p.salePrice != null && p.salePrice < p.price && (
                      <span className="rounded-full bg-deal-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        DEAL {discountPercent(p.price, p.salePrice)}% OFF
                      </span>
                    )}
                    {hasPending && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800">
                        <Clock className="h-3 w-3" /> Changes pending review
                      </span>
                    )}
                    {p.stockQuantity <= 0 && p.status !== "DRAFT" && p.status !== "ARCHIVED" && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                        Out of stock
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-subtle">
                    {p.description || "No description"}
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {p.store.name} ·{" "}
                    {p.status === "DRAFT"
                      ? "Pending MandiBazaar approval"
                      : p.status === "ARCHIVED"
                        ? "removed"
                        : p.status.toLowerCase()} · stock{" "}
                    {p.stockQuantity}
                    {p.unit ? ` · per ${p.unit}` : ""}
                  </p>
                  {hasPending && p.pendingChanges && (
                    <p className="mt-1 text-xs text-sky-800">
                      Waiting for MandiBazaar:{" "}
                      {(Object.keys(REVIEWED_FIELD_LABELS) as (keyof typeof REVIEWED_FIELD_LABELS)[])
                        .filter((k) => p.pendingChanges?.[k] !== undefined)
                        .map((k) => REVIEWED_FIELD_LABELS[k])
                        .join(", ")}
                      . Customers see the approved version until then.
                    </p>
                  )}
                  {p.moderationNote && !hasPending && (
                    <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                      Declined by MandiBazaar: {p.moderationNote}
                    </p>
                  )}
                  {p.status === "ARCHIVED" ? (
                    <p className="mt-2 text-xs text-ink-subtle">
                      This listing was removed and is hidden from customers. Add it again as a new product if needed.
                    </p>
                  ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(p)}>
                      Edit
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void toggleStatus(p)}>
                      {p.status === "DRAFT"
                        ? "Awaiting approval"
                        : p.status === "ACTIVE"
                          ? "Deactivate"
                          : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={deletingId === p.id}
                      onClick={() => void removeProduct(p)}
                    >
                      {deletingId === p.id ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                  )}
                </div>
              </div>
              <div className="shrink-0 sm:text-right">
                {p.salePrice != null && p.salePrice < p.price ? (
                  <>
                    <p className="text-xs text-ink-subtle line-through">{formatCurrency(p.price)}</p>
                    <p className="font-bold text-deal-600">{formatCurrency(p.salePrice)}</p>
                  </>
                ) : (
                  <p className="font-bold text-brand-700">{formatCurrency(p.price)}</p>
                )}
              </div>
            </div>
          );
        })}

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={(n) => {
            setPage(n);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          itemLabel="products"
        />
      </div>
    </div>
  );
}

export default function StoreProductsPageRoute() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-subtle">Loading products…</div>}>
      <StoreProductsPage />
    </Suspense>
  );
}
