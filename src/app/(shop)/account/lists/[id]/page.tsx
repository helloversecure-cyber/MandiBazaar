"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ClipboardList, Hourglass, MapPin, Pencil, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FieldError";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Countdown, ListStatusBadge, addressLine } from "@/components/lists/ListBits";
import { ListLinesEditor, type CategoryOption } from "@/components/lists/ListLinesEditor";
import { OfferCard } from "@/components/lists/OfferCard";
import { AcceptOfferDialog, type AcceptResult } from "@/components/lists/AcceptOfferDialog";
import type { ListDetail, Offer, SavedAddress } from "@/components/lists/types";
import {
  formatQty,
  linesFromList,
  listStatusInfo,
  mapServerFieldError,
  validateDraft,
  type DraftLine,
  type LineErrors,
} from "@/lib/lists/ui";
import { plural } from "@/lib/portal/format";
import { formatCurrency } from "@/lib/utils";

/** Offers refresh this often while stores are bidding. */
const REFRESH_MS = 10_000;

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [list, setList] = useState<ListDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOffer, setDialogOffer] = useState<Offer | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sent")) {
      setNotice({ text: "Your list was sent to stores near you. Offers will show up here.", ok: true });
    }
  }, []);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [draftErrors, setDraftErrors] = useState<Record<string, LineErrors>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setRefreshing(true);
      try {
        const res = await fetch(`/api/lists/${id}`, { cache: "no-store" });
        const d = await res.json().catch(() => null);
        if (!d?.success) {
          // Keep showing the last good data on a failed background refresh.
          if (!opts.quiet) setLoadError({ status: res.status, message: d?.error || "Couldn't load this list." });
          return;
        }
        setLoadError(null);
        setList(d.data);
      } catch {
        if (!opts.quiet) setLoadError({ status: 0, message: "Couldn't load this list. Check your connection and try again." });
      } finally {
        setRefreshing(false);
      }
    },
    [id]
  );

  useEffect(() => {
    void load();
    fetch("/api/addresses", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAddresses(d?.success ? d.data : []))
      .catch(() => setAddresses([]));
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setCategories((d.data as CategoryOption[]).map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {});
  }, [load]);

  const bidding = list?.status === "BIDDING" && new Date(list.expiresAt).getTime() > Date.now();

  // Auto-refresh every ~10 s while bidding (paused while editing, accepting, or the tab is hidden).
  useEffect(() => {
    if (!bidding || editing || dialogOffer) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ quiet: true });
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [bidding, editing, dialogOffer, load]);

  const offers = useMemo(() => list?.offers ?? [], [list]);
  const acceptable = useMemo(() => offers.filter((o) => o.acceptable), [offers]);

  // Keep the selected offer if it can still be accepted, otherwise pick the top one.
  useEffect(() => {
    if (!acceptable.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !acceptable.some((o) => o.bidId === selectedId)) setSelectedId(acceptable[0].bidId);
  }, [acceptable, selectedId]);

  const selected = acceptable.find((o) => o.bidId === selectedId) || null;

  const defaultAddressId = useMemo(() => {
    if (!addresses?.length) return "";
    const a = list?.address;
    const same = a
      ? addresses.find((x) => x.houseBuilding === a.houseBuilding && x.area === a.area && x.city === a.city)
      : null;
    return (same || addresses.find((x) => x.isDefault) || addresses[0]).id;
  }, [addresses, list?.address]);

  const closeDialog = useCallback(() => setDialogOffer(null), []);
  const onAccepted = useCallback(
    (r: AcceptResult) => {
      toast.success(r.reused ? "Your order was already placed." : "Order placed!");
      router.push(`/account/orders/${r.orderNumber}?from=list`);
    },
    [router, toast]
  );
  const onStale = useCallback(
    (message: string) => {
      setDialogOffer(null);
      setNotice({ text: message, ok: false });
      void load();
    },
    [load]
  );

  function startEdit() {
    if (!list) return;
    setDraft(linesFromList(list.lines));
    setDraftNote(list.note || "");
    setDraftErrors({});
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateDraft(draft);
    setDraftErrors(v.errors);
    setEditError(v.formError);
    if (v.formError || Object.keys(v.errors).length) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: draftNote.trim() || null, lines: v.payload }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.success) {
        const [field, msg] = Object.entries((d?.fieldErrors || {}) as Record<string, string>)[0] || [];
        const mapped = field ? mapServerFieldError(draft, field, msg) : null;
        if (mapped) setDraftErrors({ [mapped.lineKey]: { [mapped.field]: msg } });
        else setEditError(d?.error || "Couldn't save your changes. Please try again.");
        if (d?.code === "ORDER_PLACED" || d?.code === "LIST_CLOSED") {
          setEditing(false);
          void load();
        }
        return;
      }
      setEditing(false);
      setNotice({ text: "List updated. Stores that already made an offer are asked to update it.", ok: true });
      void load();
    } catch {
      setEditError("We couldn't reach MandiBazaar. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelList() {
    const r = await confirm({
      title: "Cancel this list?",
      message: "Stores will stop sending offers and any offers you have will close.",
      confirmLabel: "Cancel list",
      cancelLabel: "Keep list",
      tone: "danger",
    });
    if (!r.confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (!d?.success) toast.error(d?.error || "Couldn't cancel the list. Please try again.");
      else toast.success("List cancelled");
      void load();
    } catch {
      toast.error("We couldn't reach MandiBazaar. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !list) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={loadError.status === 404 ? "List not found" : "Couldn't load this list"}
        description={loadError.status === 404 ? "It may belong to another account." : loadError.message}
        actionLabel="Back to my lists"
        actionHref="/account/lists"
      />
    );
  }
  if (!list) return <div className="py-16 text-center text-sm text-ink-subtle">Loading list…</div>;

  const info = listStatusInfo(list.status);

  return (
    <div>
      <PageHeader
        title="Your list"
        subtitle={`Sent ${new Date(list.createdAt).toLocaleString()} · ${plural(list.lines.length, "item")}`}
        badge="List"
        action={
          <Button href="/account/lists" variant="outline" size="sm">
            Back to lists
          </Button>
        }
      />

      {notice && (
        <p
          role="status"
          className={
            notice.ok
              ? "mb-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
          }
        >
          {notice.text}
        </p>
      )}

      {/* Status */}
      <section className="mb-6 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5" aria-label="List status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ListStatusBadge status={list.status} />
            {bidding && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
                <Hourglass className="h-4 w-4 text-ink-subtle" />
                <Countdown until={list.expiresAt} onEnd={() => void load()} />
              </span>
            )}
          </div>
          {bidding && (
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50"
            >
              <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Refresh
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-ink-muted">{info.help}</p>
        {bidding && (
          <p className="mt-1 text-xs text-ink-subtle">
            Sent to stores within {list.radiusKm} km. If no store replies, we widen the search automatically. Offers refresh
            every few seconds.
          </p>
        )}
        {list.noPin && (
          <p className="mt-1 text-xs text-amber-700">Your address has no map pin, so only stores in {list.city} can see this list.</p>
        )}
        {list.status === "ACCEPTED" && list.orderNumber && (
          <Button href={`/account/orders/${list.orderNumber}`} size="sm" className="mt-3">
            View order {list.orderNumber}
          </Button>
        )}
        {(list.status === "NO_STORES" || list.status === "EXPIRED") && (
          <Button href="/lists/new" size="sm" variant="outline" className="mt-3">
            Send a new list
          </Button>
        )}
      </section>

      {/* Offers */}
      <section className="mb-6" aria-labelledby="offers-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="offers-title" className="text-lg font-bold text-ink">
            Offers {offers.length > 0 && <span className="text-ink-subtle">({offers.length})</span>}
          </h2>
          {acceptable.length > 1 && (
            <p className="text-xs text-ink-subtle">Sorted by items covered, then price, then speed.</p>
          )}
        </div>
        {offers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-center text-sm text-ink-muted">
            {bidding ? (
              <>
                <Hourglass className="mx-auto mb-2 h-6 w-6 text-ink-subtle" />
                <p className="font-semibold text-ink">Waiting for offers…</p>
                <p className="mt-1">Stores usually reply within 30 minutes. You can leave this page; we&apos;ll notify you.</p>
              </>
            ) : (
              <p>No store made an offer on this list.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {offers.map((o) => (
              <OfferCard
                key={o.bidId}
                offer={o}
                canAct={!!bidding}
                selected={o.bidId === selectedId}
                onSelect={() => setSelectedId(o.bidId)}
                onAccept={() => setDialogOffer(o)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Items (edit / cancel while bidding) */}
      <section className="mb-6 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5" aria-labelledby="items-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="items-title" className="font-bold text-ink">
            Items on your list
          </h2>
          {bidding && !editing && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={startEdit} disabled={busy}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit list
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelList}
                disabled={busy}
                className="border-deal-200 text-deal-600 hover:bg-red-50"
              >
                Cancel list
              </Button>
            </div>
          )}
        </div>

        {editing ? (
          <form onSubmit={saveEdit} noValidate className="space-y-3">
            <p className="text-xs text-ink-subtle">Stores that already made an offer will be asked to update it.</p>
            <ListLinesEditor
              lines={draft}
              onChange={setDraft}
              errors={draftErrors}
              onClearError={(key, field) =>
                setDraftErrors((prev) => {
                  if (!prev[key]) return prev;
                  const next = { ...prev, [key]: { ...prev[key] } };
                  delete next[key][field];
                  return next;
                })
              }
              categories={categories}
              disabled={busy}
            />
            <div>
              <label htmlFor="edit-note" className="mb-1 block text-sm font-medium text-ink">
                Note for stores (optional)
              </label>
              <textarea
                id="edit-note"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={2}
                maxLength={300}
                className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
              />
            </div>
            <FormError message={editError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                Discard
              </Button>
            </div>
          </form>
        ) : (
          <>
            <ul className="divide-y divide-line text-sm">
              {list.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-ink">{l.name}</span>
                    {l.note && <span className="block text-xs text-ink-subtle">{l.note}</span>}
                  </span>
                  <span className="shrink-0 text-ink-muted">
                    {formatQty(l.quantity)} {l.unit}
                  </span>
                </li>
              ))}
            </ul>
            {list.note && <p className="mt-3 break-words rounded-lg bg-app px-3 py-2 text-xs text-ink-muted">Note: {list.note}</p>}
          </>
        )}
      </section>

      {list.address && (
        <section className="mb-6 rounded-2xl border border-line bg-card p-4 text-sm shadow-card sm:p-5">
          <h2 className="flex items-center gap-1.5 font-bold text-ink">
            <MapPin className="h-4 w-4" /> Delivery address
          </h2>
          <p className="mt-2 break-words text-ink-muted">
            {list.address.fullName}
            {list.address.phone ? `, ${list.address.phone}` : ""}
            <br />
            {addressLine(list.address)}
          </p>
          {list.status === "ACCEPTED" && list.orderNumber && (
            <p className="mt-2 text-xs text-ink-subtle">
              See the <Link href={`/account/orders/${list.orderNumber}`} className="font-semibold text-brand-600 underline">order</Link> for the address it&apos;s delivered to.
            </p>
          )}
        </section>
      )}

      {/* Phones/tablets: the chosen offer and the Accept button stay above the bottom nav. */}
      {bidding && selected && !editing && (
        <div
          data-testid="accept-bar"
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-3 shadow-card lg:hidden"
        >
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-muted">{selected.store.name}</p>
            <p className="font-bold text-ink">
              {formatCurrency(selected.total)}{" "}
              <span className="text-xs font-normal text-ink-subtle">
                · {selected.coveredCount}/{selected.lineCount} items
              </span>
            </p>
          </div>
          <Button type="button" onClick={() => setDialogOffer(selected)} className="shrink-0 px-4">
            Accept offer
          </Button>
        </div>
      )}

      {dialogOffer && (
        <AcceptOfferDialog
          listId={list.id}
          listVersion={list.version}
          offer={dialogOffer}
          addresses={addresses}
          defaultAddressId={defaultAddressId}
          onClose={closeDialog}
          onAccepted={onAccepted}
          onStale={onStale}
        />
      )}
    </div>
  );
}
