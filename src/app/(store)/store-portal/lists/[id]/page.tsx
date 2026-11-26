"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Countdown, RoundBadge } from "@/components/lists/ListBits";
import { formatQty } from "@/lib/lists/ui";
import {
  applyServerBidError,
  bidDraftFor,
  bidTotals,
  listOpen,
  storeBidErrorMessage,
  storeListState,
  validateBidDraft,
  type BidDraft,
  type BidFieldErrors,
  type StoreListDetail,
} from "@/lib/lists/store-ui";
import { cn, formatCurrency } from "@/lib/utils";

type Failure = { status: number; code?: string | null; error?: string | null; fieldErrors?: Record<string, string> };

async function call(url: string, init?: RequestInit): Promise<{ ok: true; data: unknown } | { ok: false; f: Failure | null }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.success) return { ok: true, data: body.data };
    return { ok: false, f: { status: res.status, code: body?.code, error: body?.error, fieldErrors: body?.fieldErrors } };
  } catch {
    return { ok: false, f: null };
  }
}

const inputCls =
  "w-full rounded-xl border bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-400 min-h-[44px]";

export default function StoreListBidPage() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const storeId = sp.get("storeId");
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<StoreListDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<BidDraft | null>(null);
  const [errors, setErrors] = useState<BidFieldErrors>({ lines: {} });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "withdraw" | "decline">("");
  const [editing, setEditing] = useState(false);
  const draftRef = useRef<BidDraft | null>(null);
  draftRef.current = draft;

  const qs = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";

  const load = useCallback(
    async (opts: { keepDraft?: boolean } = {}) => {
      const r = await call(`/api/store/lists/${params.id}${qs}`);
      if (!r.ok) {
        setLoadError(storeBidErrorMessage(r.f).message);
        return null;
      }
      const l = r.data as StoreListDetail;
      setLoadError("");
      setList(l);
      setDraft(bidDraftFor(l, opts.keepDraft ? draftRef.current : null));
      return l;
    },
    [params.id, qs]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => (list && draft ? bidTotals(list.lines, draft) : null), [list, draft]);

  if (loadError && !list) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <p role="alert" className="mt-4 rounded-2xl bg-red-50 px-4 py-6 text-center text-sm text-red-700">
          {loadError}
        </p>
      </div>
    );
  }
  if (!list || !draft || !totals) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <BackLink />
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  const state = storeListState(list);
  const open = listOpen(list);
  const pending = list.myBid?.status === "PENDING";
  const showForm = open && (!pending || editing || list.myBid?.needsUpdate) && state.key !== "WON";
  const place = [list.area, list.city].filter(Boolean).join(", ");

  function setLine(lineId: string, patch: Partial<BidDraft["lines"][number]>) {
    setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)) } : d));
    setErrors((e) => {
      if (!e.lines[lineId] && !e.form) return e;
      const lines = { ...e.lines };
      delete lines[lineId];
      return { ...e, lines, form: undefined };
    });
  }

  async function save() {
    if (!list || !draft) return;
    setNotice("");
    const v = validateBidDraft(list, draft);
    setErrors(v.errors);
    if (!v.payload) {
      toast.error(v.errors.form || "Check the highlighted fields.");
      return;
    }
    setBusy("save");
    const r = await call(`/api/store/lists/${list.listId}/bid`, { method: "PUT", body: JSON.stringify(v.payload) });
    setBusy("");
    if (r.ok) {
      toast.success(pending ? "Offer updated. The customer can see it." : "Offer sent. The customer can see it now.");
      setEditing(false);
      setErrors({ lines: {} });
      await load();
      return;
    }
    const m = storeBidErrorMessage(r.f);
    const [field, msg] = Object.entries(r.f?.fieldErrors ?? {})[0] ?? [null, null];
    setErrors(field ? applyServerBidError(list.lines, field, msg || m.message) : { lines: {}, form: m.message });
    setNotice(m.message);
    if (m.reload) await load({ keepDraft: true });
  }

  async function withdraw() {
    if (!list) return;
    const c = await confirm({
      title: "Withdraw your offer?",
      message: "The customer will no longer see it. You can send a new offer while the list is open.",
      confirmLabel: "Withdraw offer",
      tone: "danger",
    });
    if (!c.confirmed) return;
    setBusy("withdraw");
    const r = await call(`/api/store/lists/${list.listId}/bid${qs}`, { method: "DELETE" });
    setBusy("");
    if (r.ok) toast.success("Offer withdrawn");
    else toast.error(storeBidErrorMessage(r.f).message);
    setEditing(false);
    await load();
  }

  async function decline() {
    if (!list) return;
    const c = await confirm({
      title: "Can't supply this list?",
      message: "The customer won't see an offer from you. You can still send one later while the list is open.",
      confirmLabel: "Can't supply",
    });
    if (!c.confirmed) return;
    setBusy("decline");
    const r = await call(`/api/store/lists/${list.listId}/decline`, { method: "POST", body: JSON.stringify({ storeId: list.storeId }) });
    setBusy("");
    if (r.ok) toast.success("Marked as can't supply");
    else toast.error(storeBidErrorMessage(r.f).message);
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <BackLink />

      <header className="mt-3 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
            {open && <RoundBadge round={list.round} />}
          </span>
          {open && (
            <span className="flex items-center gap-1 text-sm font-medium text-ink-muted">
              <Clock className="h-4 w-4" />
              <Countdown until={list.roundEndsAt ?? list.expiresAt} onEnd={() => void load()} />
            </span>
          )}
        </div>
        <h1 className="mt-3 font-display text-2xl text-ink">
          {list.lines.length} item{list.lines.length === 1 ? "" : "s"} for a customer near you
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span className="flex items-center gap-1">
            <MapPin className="h-4 w-4" />
            {place || list.city}
          </span>
          {list.distanceKm != null && <span>{list.distanceKm.toFixed(1)} km from your store</span>}
        </p>
        <p className="mt-2 text-sm text-ink-subtle">{state.help}</p>
        {list.note && (
          <p className="mt-3 break-words rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="font-semibold">Customer note: </span>
            {list.note}
          </p>
        )}
      </header>

      {state.key === "WON" && list.myBid?.orderNumber && (
        <section
          data-testid="won-panel"
          className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-500/30 dark:bg-emerald-500/10"
        >
          <p className="flex items-start gap-2 text-sm text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              The customer accepted your offer of <strong>{formatCurrency(list.myBid.total)}</strong>. It is now order{" "}
              <strong>{list.myBid.orderNumber}</strong>.
            </span>
          </p>
          <Link
            href={`/store-portal/orders?tab=all&q=${encodeURIComponent(list.myBid.orderNumber)}`}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Open order {list.myBid.orderNumber}
          </Link>
        </section>
      )}

      {notice && (
        <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </p>
      )}

      {showForm ? (
        <form
          className="mt-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <section className="rounded-2xl border border-line bg-card shadow-card">
            <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink sm:px-5">
              Your prices <span className="font-normal text-ink-subtle">(per unit, in rupees)</span>
            </h2>
            <ul className="divide-y divide-line">
              {list.lines.map((line) => {
                const d = draft.lines.find((x) => x.lineId === line.id)!;
                const err = errors.lines[line.id];
                const lineTotal = totals.lineTotals[line.id];
                return (
                  <li key={line.id} className="px-4 py-3 sm:px-5" data-testid="bid-line">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold text-ink">{line.name}</p>
                        <p className="text-sm text-ink-muted">
                          {formatQty(line.quantity)} {line.unit}
                          {line.category ? ` · ${line.category}` : ""}
                        </p>
                        {line.note && <p className="mt-0.5 break-words text-xs text-ink-subtle">“{line.note}”</p>}
                      </div>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-ink-muted">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-red-600"
                          checked={!d.available}
                          onChange={(e) => setLine(line.id, { available: !e.target.checked })}
                        />
                        Don&apos;t have
                      </label>
                    </div>
                    {d.available ? (
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <label className="block min-w-0">
                          <span className="sr-only">Price per {line.unit} for {line.name}</span>
                          <div
                            className={cn(
                              "flex min-h-[44px] items-center rounded-xl border bg-card px-3 focus-within:border-brand-400",
                              err ? "border-red-400" : "border-line"
                            )}
                          >
                            <span className="text-sm text-ink-subtle">Rs</span>
                            <input
                              inputMode="decimal"
                              aria-label={`Price per ${line.unit} for ${line.name}`}
                              aria-invalid={!!err}
                              placeholder={`per ${line.unit}`}
                              value={d.price}
                              onChange={(e) => setLine(line.id, { price: e.target.value })}
                              className="min-h-[44px] min-w-0 flex-1 bg-transparent px-2 py-0 text-sm text-ink outline-none"
                            />
                          </div>
                        </label>
                        <span className="text-right text-sm font-semibold tabular-nums text-ink" data-testid="line-total">
                          {lineTotal ? formatCurrency(lineTotal) : "—"}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-ink-subtle">Not in your offer</p>
                    )}
                    {err && <p className="mt-1 text-xs font-medium text-red-600">{err}</p>}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-line bg-card p-4 shadow-card sm:grid-cols-2 sm:p-5">
            <label className="block">
              <span className="text-sm font-medium text-ink">Discount (Rs, optional)</span>
              <input
                inputMode="decimal"
                value={draft.discount}
                onChange={(e) => setDraft({ ...draft, discount: e.target.value })}
                className={cn(inputCls, "mt-1", errors.discount ? "border-red-400" : "border-line")}
              />
              {errors.discount && <span className="mt-1 block text-xs font-medium text-red-600">{errors.discount}</span>}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Preparation time (minutes)</span>
              <input
                inputMode="numeric"
                placeholder="e.g. 30"
                value={draft.prepMinutes}
                onChange={(e) => setDraft({ ...draft, prepMinutes: e.target.value })}
                className={cn(inputCls, "mt-1", errors.prepMinutes ? "border-red-400" : "border-line")}
              />
              {errors.prepMinutes && <span className="mt-1 block text-xs font-medium text-red-600">{errors.prepMinutes}</span>}
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-ink">Note to the customer (optional)</span>
              <textarea
                rows={2}
                maxLength={320}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                className={cn(inputCls, "mt-1", errors.note ? "border-red-400" : "border-line")}
                placeholder="e.g. Fresh stock today, brand options available"
              />
              <span className="mt-1 flex justify-between text-xs">
                <span className="font-medium text-red-600">{errors.note}</span>
                <span className="text-ink-subtle">{draft.note.trim().length}/300</span>
              </span>
            </label>
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-card p-4 text-sm shadow-card sm:p-5" data-testid="bid-summary">
            <Row label="Items you have" value={`${totals.covered} of ${totals.lineCount}`} />
            <Row label="Items total" value={formatCurrency(totals.itemsTotal)} />
            {totals.discount > 0 && <Row label="Discount" value={`− ${formatCurrency(totals.discount)}`} />}
            <Row label="Offer total" value={formatCurrency(totals.total)} strong testId="bid-total" />
            <p className="mt-2 text-xs text-ink-subtle">The delivery fee is set later by rider bidding and paid to the rider.</p>
            {errors.form && <p className="mt-2 text-sm font-medium text-red-600">{errors.form}</p>}
          </section>

          {/* Phones: total + send stay above the bottom nav (L-06). */}
          <div className="sticky bottom-[60px] z-20 -mx-4 mt-4 border-t border-line bg-card/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:rounded-2xl lg:border lg:shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                Total <span className="font-bold text-ink">{formatCurrency(totals.total)}</span> · {totals.covered}/{totals.lineCount}{" "}
                items
              </p>
              <div className="flex flex-wrap gap-2">
                {pending && (
                  <Button type="button" variant="outline" onClick={() => (editing ? setEditing(false) : void load())}>
                    Cancel
                  </Button>
                )}
                {!pending && !list.declined && (
                  <Button type="button" variant="outline" disabled={!!busy} onClick={() => void decline()}>
                    {busy === "decline" ? "Saving…" : "Can't supply"}
                  </Button>
                )}
                <Button type="submit" disabled={!!busy}>
                  {busy === "save" ? "Sending…" : pending ? "Update offer" : "Send offer"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        list.myBid &&
        list.myBid.status !== "WITHDRAWN" && (
          <section className="mt-4 rounded-2xl border border-line bg-card shadow-card" data-testid="my-offer">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-sm font-bold text-ink">Your offer</h2>
              <span className="text-xs text-ink-subtle">Updated {new Date(list.myBid.updatedAt).toLocaleString("en-PK")}</span>
            </div>
            <ul className="divide-y divide-line text-sm">
              {list.lines.map((line) => {
                const b = list.myBid!.lines.find((x) => x.lineId === line.id);
                return (
                  <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <span className="min-w-0 break-words text-ink">
                      {line.name} <span className="text-ink-subtle">· {formatQty(line.quantity)} {line.unit}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {b?.available && b.unitPrice != null ? `${formatCurrency(b.unitPrice)} / ${line.unit}` : "Don't have"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-line px-4 py-3 text-sm sm:px-5">
              {list.myBid.discount > 0 && <Row label="Discount" value={`− ${formatCurrency(list.myBid.discount)}`} />}
              {list.myBid.prepMinutes != null && <Row label="Preparation time" value={`${list.myBid.prepMinutes} min`} />}
              <Row label="Offer total" value={formatCurrency(list.myBid.total)} strong testId="offer-total" />
              {list.myBid.note && <p className="mt-2 break-words text-ink-muted">“{list.myBid.note}”</p>}
            </div>
            {open && pending && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => void withdraw()}>
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw offer"}
                </Button>
                <Button type="button" onClick={() => setEditing(true)}>
                  Edit offer
                </Button>
              </div>
            )}
          </section>
        )
      )}

      {open && list.declined && !pending && !showForm && (
        <p className="mt-4 text-sm text-ink-muted">You said you can&apos;t supply this list.</p>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/store-portal/lists"
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
    >
      <ArrowLeft className="h-4 w-4" /> Incoming lists
    </Link>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <p className={cn("flex items-center justify-between gap-3 py-0.5", strong && "mt-1 border-t border-line pt-2 text-base")}>
      <span className={strong ? "font-semibold text-ink" : "text-ink-muted"}>{label}</span>
      <span className={cn("tabular-nums", strong ? "font-bold text-ink" : "text-ink")} data-testid={testId}>
        {value}
      </span>
    </p>
  );
}
