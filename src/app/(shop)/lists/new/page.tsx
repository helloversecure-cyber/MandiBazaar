"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ClipboardList, Store } from "lucide-react";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FieldError";
import { ListLinesEditor, type CategoryOption } from "@/components/lists/ListLinesEditor";
import { AddressPicker } from "@/components/lists/ListBits";
import { useListBidding } from "@/components/lists/useListBidding";
import type { SavedAddress } from "@/components/lists/types";
import {
  emptyLine,
  isBlankLine,
  linesFromCart,
  mapServerFieldError,
  validateDraft,
  type DraftLine,
  type LineErrors,
} from "@/lib/lists/ui";

const DRAFT_KEY = "mb_list_draft";

function NewListContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const fromCart = sp.get("from") === "cart";
  const { status } = useSession();
  const enabled = useListBidding();

  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine()]);
  const [note, setNote] = useState("");
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [addressId, setAddressId] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [errors, setErrors] = useState<Record<string, LineErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(fromCart ? "/lists/new?from=cart" : "/lists/new")}`);
    }
  }, [status, router, fromCart]);

  // Saved addresses, categories, and the starting lines (draft, cart, or one empty line).
  useEffect(() => {
    if (status !== "authenticated" || !enabled) return;
    let alive = true;
    fetch("/api/addresses", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list: SavedAddress[] = d?.success ? d.data : [];
        setAddresses(list);
        setAddressId((cur) => cur || (list.find((a) => a.isDefault) || list[0])?.id || "");
      })
      .catch(() => alive && setAddresses([]));
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.success) setCategories((d.data as CategoryOption[]).map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {});

    (async () => {
      let start: DraftLine[] | null = null;
      try {
        const saved = sessionStorage.getItem(DRAFT_KEY);
        if (saved) {
          const d = JSON.parse(saved) as { lines: DraftLine[]; note: string };
          if (Array.isArray(d.lines) && d.lines.length) {
            start = d.lines;
            setNote(d.note || "");
          }
        }
      } catch {
        /* ignore */
      }
      // A saved draft (e.g. back from adding an address) wins over refilling from the cart.
      if (fromCart && !start) {
        try {
          const d = await (await fetch("/api/cart", { cache: "no-store" })).json();
          const items = (d?.data?.items || []) as Parameters<typeof linesFromCart>[0];
          if (items.length) start = [...linesFromCart(items), emptyLine()];
        } catch {
          /* keep what we have */
        }
      }
      if (alive) {
        if (start) setLines(start);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [status, enabled, fromCart]);

  // Keep a draft while the customer goes to add an address and comes back.
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ lines, note }));
    } catch {
      /* ignore */
    }
  }, [lines, note, ready]);

  const clearError = useCallback((key: string, field: keyof LineErrors) => {
    setErrors((prev) => {
      if (!prev[key]?.[field]) return prev;
      const next = { ...prev, [key]: { ...prev[key] } };
      delete next[key][field];
      if (!Object.keys(next[key]).length) delete next[key];
      return next;
    });
    setFormError(null);
  }, []);

  const count = useMemo(() => lines.filter((l) => !isBlankLine(l)).length, [lines]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setFormError(null);
    setAddressError(null);
    setNoteError(null);
    const v = validateDraft(lines);
    setErrors(v.errors);
    let bad = !!v.formError || Object.keys(v.errors).length > 0;
    if (v.formError) setFormError(v.formError);
    if (!addressId) {
      setAddressError("Choose a delivery address");
      bad = true;
    }
    if (note.trim().length > 300) {
      setNoteError("Note must be 300 characters or fewer");
      bad = true;
    }
    if (bad) {
      const first = Object.keys(v.errors)[0];
      const el = first ? document.getElementById(`line-${first}-name`) : null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId, note: note.trim() || null, lines: v.payload }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) {
        const fe = (data?.fieldErrors || {}) as Record<string, string>;
        const [field, msg] = Object.entries(fe)[0] || [];
        const mapped = field ? mapServerFieldError(lines, field, msg) : null;
        if (mapped) setErrors({ [mapped.lineKey]: { [mapped.field]: msg } });
        else if (field === "addressId") setAddressError(msg);
        else if (field === "note") setNoteError(msg);
        else setFormError(data?.error || (res.status === 401 ? "Please sign in again." : "Couldn't send your list. Please try again."));
        return;
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/account/lists/${data.data.id}?sent=1`);
    } catch {
      setFormError("We couldn't reach MandiBazaar. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "unauthenticated" || enabled === null) {
    return (
      <ShopContainer width="lg">
        <div className="skeleton h-72 rounded-2xl" />
      </ShopContainer>
    );
  }

  if (!enabled) {
    return (
      <ShopContainer width="md">
        <EmptyState
          icon={ClipboardList}
          title="Sending a list isn't available yet"
          description="We're testing this with a few customers first. You can still order everything in the catalogue."
          actionLabel="Browse products"
          actionHref="/products"
        />
      </ShopContainer>
    );
  }

  return (
    <ShopContainer width="lg">
      <Breadcrumbs items={[{ label: "My lists", href: "/account/lists" }, { label: "Send a list" }]} />
      <PageHeader
        title="Send a list to stores"
        subtitle="Nearby stores send their prices. Compare the offers and accept the one you like."
        badge="New list"
      />

      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 pb-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0 space-y-4">
          {fromCart && (
            <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200">
              Your cart items are in the list. Add anything that isn&apos;t in the catalogue below.
            </p>
          )}
          <ListLinesEditor
            lines={lines}
            onChange={setLines}
            errors={errors}
            onClearError={clearError}
            categories={categories}
            disabled={busy}
          />
          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <label htmlFor="list-note" className="mb-1 block text-sm font-medium text-ink">
              Note for stores (optional)
            </label>
            <textarea
              id="list-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              rows={2}
              maxLength={300}
              placeholder="e.g. Please deliver before 6 pm"
              className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
            />
            {noteError && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{noteError}</p>}
          </div>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-36 lg:self-start">
          <div className="rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
            <h2 className="mb-3 font-bold text-ink">Deliver to</h2>
            <AddressPicker
              addresses={addresses}
              value={addressId}
              onChange={(id) => {
                setAddressId(id);
                setAddressError(null);
              }}
              error={addressError}
              returnTo={fromCart ? "/lists/new?from=cart" : "/lists/new"}
            />
          </div>
          <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-card sm:p-5">
            <h2 className="flex items-center gap-2 font-bold text-ink">
              <Store className="h-4 w-4" /> How it works
            </h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-muted">
              <li>We send your list to stores near your address.</li>
              <li>Stores reply with prices and the items they have.</li>
              <li>You accept one offer and pay cash on delivery.</li>
              <li>After packing, riders bid on the delivery fee and you choose one.</li>
            </ol>
            <FormError message={formError} />
            <Button type="submit" size="lg" disabled={busy} className="mt-4 hidden w-full lg:inline-flex">
              {busy ? "Sending…" : `Send to stores${count ? ` (${count} item${count === 1 ? "" : "s"})` : ""}`}
            </Button>
          </div>
        </aside>

        {/* Phones and tablets: the send button stays above the bottom nav. */}
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-3 shadow-card lg:hidden">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">Your list</p>
            <p className="font-bold text-ink">
              {count} item{count === 1 ? "" : "s"}
            </p>
          </div>
          <Button type="submit" disabled={busy} className="shrink-0 px-4">
            {busy ? "Sending…" : "Send to stores"}
          </Button>
        </div>
      </form>
    </ShopContainer>
  );
}

export default function NewListPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto my-6 h-72 max-w-6xl rounded-2xl" />}>
      <NewListContent />
    </Suspense>
  );
}
