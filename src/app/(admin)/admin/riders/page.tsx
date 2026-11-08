"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import type { RoleName } from "@prisma/client";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { RIDER_DOCUMENT_FIELDS, type RiderDocumentKey } from "@/lib/riders/documents";
import { RiderPayPanel, PayRiderButton } from "@/components/admin/RiderPayPanel";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { TempPasswordNotice } from "@/components/admin/TempPasswordNotice";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { riderQuickAddSchema } from "@/lib/admin/form-rules";
import { PK_CITIES, VEHICLE_TYPES } from "@/lib/validators/pk";

type RiderRow = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  vehicleType: string | null;
  cnicNumber: string | null;
  photoUrl: string | null;
  cnicUrl: string | null;
  cnicBackUrl: string | null;
  licenseUrl: string | null;
  bikeUrl: string | null;
  bikeCardUrl: string | null;
  accountNumber: string | null;
  accountTitle: string | null;
  bankName: string | null;
  jazzCashNumber: string | null;
  approvalStatus: string;
  reviewNotes: string | null;
  isActive: boolean;
  status: string;
  approvalProblems: string[];
  unpaid?: { count: number; amount: number };
  user: { id: string; email: string | null } | null;
  reviewedBy: { fullName: string } | null;
  _count: { orders: number };
};

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  password: "",
  cnicNumber: "",
  city: "",
  vehicleType: "Bike",
  accountTitle: "",
  bankName: "",
  accountNumber: "",
  jazzCashNumber: "",
};

const EMPTY_DOCS: Record<RiderDocumentKey, string> = {
  photoUrl: "",
  cnicUrl: "",
  cnicBackUrl: "",
  licenseUrl: "",
  bikeUrl: "",
  bikeCardUrl: "",
};

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "INACTIVE", label: "Deactivated" },
  { key: "REJECTED", label: "Rejected" },
] as const;

const PAGE_SIZE = 25;
const statusColor: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
};

function DocThumb({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-red-200 bg-red-50 text-center text-[10px] text-red-500">
        No {label}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="relative block h-20 w-20 overflow-hidden rounded-lg border border-line"
      title={label}
    >
      <Image src={url} alt={label} fill className="object-cover" sizes="80px" unoptimized />
    </a>
  );
}

export default function AdminRidersPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const fe = useFieldErrors();
  const [items, setItems] = useState<RiderRow[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [createdCreds, setCreatedCreds] = useState<{ identifier: string; message?: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState(EMPTY_DOCS);
  const [docsFor, setDocsFor] = useState<string | null>(null);
  const [docsEdit, setDocsEdit] = useState(EMPTY_DOCS);
  const [savingDocs, setSavingDocs] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [payRule, setPayRule] = useState("");
  const { data: session } = useSession();
  const role = session?.user?.role as RoleName | undefined;
  const canPay = role ? hasPermission(role, PERMISSIONS.PAYOUTS_WRITE) : false;
  const canSeePay = role ? hasPermission(role, PERMISSIONS.PAYOUTS_READ) : false;
  const reqId = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ resource: "riders", page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load riders");
        return;
      }
      setItems(d.data.items);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
      setPendingCount(d.data.pendingCount ?? 0);
      setPayRule(d.data.payRule || "");
    } catch {
      if (my === reqId.current) toast.error("Could not load riders. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    fe.clear(key);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreatedCreds(null);
    if (!fe.check(riderQuickAddSchema, form)) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "rider", data: { ...form, ...docs } }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        return;
      }
      fe.clear();
      toast.success("Rider created — pending until a Super Admin approves");
      setCreatedCreds(data.data.loginHint);
      setForm(EMPTY_FORM);
      setDocs(EMPTY_DOCS);
      void load();
    } catch {
      fe.setFormError("Could not create the rider. Check your connection.");
    } finally {
      setCreating(false);
    }
  }

  async function approve(r: RiderRow) {
    if (r.approvalProblems.length) {
      toast.error(`Can't approve yet: ${r.approvalProblems.join("; ")}`);
      return;
    }
    const c = await confirm({
      title: `Approve ${r.name}?`,
      message: "They can sign in to the rider portal and be assigned deliveries immediately.",
      confirmLabel: "Approve rider",
    });
    if (!c.confirmed) return;
    await review(r, "APPROVED");
  }

  async function reject(r: RiderRow) {
    const c = await confirm({
      title: `Reject ${r.name}'s application?`,
      message: "The rider can't sign in to take deliveries. They see your reason.",
      confirmLabel: "Reject",
      tone: "danger",
      reason: { label: "Reason (shown to the rider)", required: true, minLength: 5, placeholder: "e.g. CNIC photo is blurred" },
    });
    if (!c.confirmed) return;
    await review(r, "REJECTED", c.reason);
  }

  async function review(r: RiderRow, decision: "APPROVED" | "REJECTED", notes?: string) {
    setBusyId(r.id);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "rider", id: r.id, data: { action: "REVIEW", decision, notes } }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Review failed");
        return;
      }
      toast.success(decision === "APPROVED" ? `${r.name} approved` : `${r.name} rejected`);
      void load();
    } catch {
      toast.error("Review failed. Check your connection.");
    } finally {
      setBusyId("");
    }
  }

  function openDocs(r: RiderRow) {
    setDocsFor(docsFor === r.id ? null : r.id);
    setDocsEdit(EMPTY_DOCS);
  }

  async function saveDocs(r: RiderRow) {
    const changed = Object.fromEntries(Object.entries(docsEdit).filter(([, v]) => v));
    if (!Object.keys(changed).length) {
      toast.error("Upload at least one document first");
      return;
    }
    setSavingDocs(true);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "rider", id: r.id, data: { action: "DOCUMENTS", ...changed } }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Could not save documents");
        return;
      }
      toast.success(
        data.data.approvalProblems?.length
          ? "Documents saved — still missing items before approval"
          : "Documents saved — you can approve this rider now"
      );
      setDocsFor(null);
      setDocsEdit(EMPTY_DOCS);
      void load();
    } catch {
      toast.error("Could not save documents. Check your connection.");
    } finally {
      setSavingDocs(false);
    }
  }

  async function toggleActive(r: RiderRow) {
    const deactivating = r.isActive;
    const c = await confirm({
      title: deactivating ? `Deactivate ${r.name}?` : `Activate ${r.name}?`,
      message: deactivating
        ? "They won't be offered new deliveries. Orders already assigned stay with them until you reassign."
        : "They can be assigned deliveries again.",
      confirmLabel: deactivating ? "Deactivate" : "Activate",
      tone: deactivating ? "danger" : "default",
    });
    if (!c.confirmed) return;
    setBusyId(r.id);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "rider", id: r.id, data: { isActive: !r.isActive } }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Update failed");
        return;
      }
      toast.success(`${r.name} ${deactivating ? "deactivated" : "activated"}`);
      void load();
    } catch {
      toast.error("Update failed. Check your connection.");
    } finally {
      setBusyId("");
    }
  }

  const input = (key: keyof typeof EMPTY_FORM, props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) => {
    const { label, ...rest } = props;
    return (
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink-muted">{label}</span>
        <input
          {...rest}
          value={form[key]}
          aria-invalid={fe.has(key)}
          onChange={(e) => set(key, e.target.value)}
          className={inputClass(fe.has(key))}
        />
        <FieldError message={fe.get(key)} />
      </label>
    );
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-ink">Riders</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        New riders upload CNIC front &amp; back, photo, license, bike, bike card + account number. Review &amp;
        approve here. Login: <code className="rounded bg-slate-100 px-1">/login?portal=rider</code>
      </p>
      {canSeePay && payRule && (
        <p className="mt-1 text-xs text-ink-subtle">
          Rider pay: {payRule} (change it in Settings). Pay is fixed when an order is delivered; failed and
          returned deliveries are not paid.
        </p>
      )}

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setStatus("PENDING");
            setPage(1);
          }}
          className="mt-4 block w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900"
        >
          <strong>{pendingCount}</strong> rider application(s) waiting for your approval — show them
        </button>
      )}

      <form
        onSubmit={create}
        noValidate
        className="mt-6 grid gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-2"
      >
        <p className="text-sm font-semibold text-ink-muted md:col-span-2">
          Quick-add rider (starts as pending — approve it below after checking documents)
        </p>
        {input("name", { label: "Full name", placeholder: "Muhammad Ali", autoComplete: "off", maxLength: 60 })}
        {input("phone", { label: "Mobile (login)", placeholder: "03001234567", inputMode: "tel", maxLength: 16 })}
        {input("email", { label: "Email (optional)", type: "email", placeholder: "ali@gmail.com", maxLength: 100 })}
        {input("cnicNumber", { label: "CNIC", placeholder: "35202-1234567-1", inputMode: "numeric", maxLength: 15 })}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-muted">City</span>
          <select
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            aria-invalid={fe.has("city")}
            className={inputClass(fe.has("city"))}
          >
            <option value="">Choose city</option>
            {PK_CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <FieldError message={fe.get("city")} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-muted">Vehicle</span>
          <select
            value={form.vehicleType}
            onChange={(e) => set("vehicleType", e.target.value)}
            aria-invalid={fe.has("vehicleType")}
            className={inputClass(fe.has("vehicleType"))}
          >
            {VEHICLE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <FieldError message={fe.get("vehicleType")} />
        </label>
        {input("accountTitle", { label: "Account title (optional)", placeholder: "Same as name", maxLength: 60 })}
        {input("bankName", { label: "Bank name (optional)", placeholder: "e.g. Meezan Bank", maxLength: 60 })}
        {input("accountNumber", { label: "Bank account no. or IBAN (optional)", placeholder: "PK36SCBL0000001123456702", maxLength: 34 })}
        {input("jazzCashNumber", { label: "JazzCash number (optional)", placeholder: "03001234567", inputMode: "tel", maxLength: 16 })}
        <div className="md:col-span-2">
          <p className="text-sm font-semibold text-ink-muted">Documents (optional now — needed before approval)</p>
          <p className="text-xs text-ink-subtle">
            Photo, CNIC front &amp; back are always needed; licence, bike photo and bike card unless the vehicle is a
            bicycle. You can also add them later with &quot;Add / replace documents&quot;.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RIDER_DOCUMENT_FIELDS.map((f) => (
              <div key={f.key}>
                <ImageUploadField
                  label={f.label}
                  value={docs[f.key]}
                  onChange={(url) => {
                    setDocs((d) => ({ ...d, [f.key]: url }));
                    fe.clear(f.key);
                  }}
                  folder="riders"
                  kind={f.kind}
                />
                <FieldError message={fe.get(f.key)} />
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          {input("password", {
            label: "Temporary password (optional)",
            type: "password",
            autoComplete: "new-password",
            maxLength: 64,
            placeholder: "Leave blank to generate a random one",
          })}
          <p className="mt-1 text-xs text-ink-subtle">
            8–64 characters with a letter and a number. The rider must change it on first login.
          </p>
        </div>
        <div className="md:col-span-2">
          <FormError message={fe.formError} />
          <Button type="submit" className="mt-2" disabled={creating}>
            {creating ? "Creating…" : "Add rider + login"}
          </Button>
        </div>
      </form>

      {createdCreds && (
        <TempPasswordNotice
          identifier={createdCreds.identifier}
          message={createdCreds.message}
          onDismiss={() => setCreatedCreds(null)}
        />
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => {
                setStatus(t.key);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs ${
                status === t.key ? "bg-slate-800 text-white" : "bg-slate-100 text-ink-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, city or CNIC…"
          aria-label="Search riders"
          className="w-full rounded-full border border-line px-4 py-2 text-sm sm:w-72"
        />
      </div>

      <div className="mt-4 space-y-3">
        {!loading && items.length === 0 && (
          <p className="text-sm text-ink-subtle">
            {query ? `No riders match "${query}".` : "No riders in this list."}
          </p>
        )}
        {items.map((r) => (
          <div key={r.id} className="rounded-2xl border border-line bg-card px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100">
                  {r.photoUrl ? (
                    <Image src={r.photoUrl} alt={r.name} fill className="object-cover" sizes="56px" unoptimized />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-subtle">?</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {r.name}{" "}
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        statusColor[r.approvalStatus] || "bg-slate-100"
                      }`}
                    >
                      {r.approvalStatus === "PENDING" ? "Pending — approve after checking documents" : r.approvalStatus}
                    </span>
                    {r.approvalStatus === "APPROVED" && !r.isActive && (
                      <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-muted">
                        Deactivated
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-ink-subtle">
                    {r.phone} · {r.city || "—"} · {r.vehicleType || "Bike"} · {r._count.orders} orders
                  </p>
                  <p className="break-all text-xs text-ink-subtle">
                    Account: {r.accountTitle || "—"} · {r.accountNumber || r.jazzCashNumber || "no account #"}
                    {r.bankName ? ` · ${r.bankName}` : ""}
                  </p>
                  <p className="text-xs text-ink-subtle">CNIC: {r.cnicNumber || "—"}</p>
                  {canSeePay && r.unpaid && (
                    <p className={`mt-1 text-xs font-semibold ${r.unpaid.count ? "text-amber-700" : "text-ink-subtle"}`}>
                      Unpaid: {r.unpaid.count} {r.unpaid.count === 1 ? "delivery" : "deliveries"} ·{" "}
                      {formatCurrency(r.unpaid.amount)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-ink-muted"
                >
                  {expanded === r.id ? "Hide docs" : "View docs"}
                </button>
                {r.approvalStatus === "PENDING" && (
                  <button
                    type="button"
                    onClick={() => openDocs(r)}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-ink-muted"
                  >
                    {docsFor === r.id ? "Close documents" : "Add / replace documents"}
                  </button>
                )}
                {canSeePay && (
                  <button
                    type="button"
                    onClick={() => setHistoryFor(historyFor === r.id ? null : r.id)}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-ink-muted"
                  >
                    {historyFor === r.id ? "Hide payouts" : "Payout history"}
                  </button>
                )}
                {canPay && r.unpaid && r.unpaid.count > 0 && (
                  <PayRiderButton riderId={r.id} riderName={r.name} onPaid={() => void load()} />
                )}
                {r.approvalStatus === "APPROVED" && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void toggleActive(r)}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-ink-muted disabled:opacity-50"
                  >
                    {r.isActive ? "Deactivate" : "Activate"}
                  </button>
                )}
              </div>
            </div>

            {docsFor === r.id && r.approvalStatus === "PENDING" && (
              <div className="mt-4 rounded-xl border border-line bg-app p-3">
                <p className="text-sm font-semibold text-ink-muted">Add / replace documents</p>
                <p className="text-xs text-ink-subtle">Only the files you upload here are replaced; the rest stay as they are.</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {RIDER_DOCUMENT_FIELDS.map((f) => (
                    <ImageUploadField
                      key={f.key}
                      label={`${f.label}${r[f.key] ? " (replace)" : ""}`}
                      value={docsEdit[f.key]}
                      onChange={(url) => setDocsEdit((d) => ({ ...d, [f.key]: url }))}
                      folder="riders"
                      kind={f.kind}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={savingDocs} onClick={() => void saveDocs(r)}>
                    {savingDocs ? "Saving…" : "Save documents"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={savingDocs} onClick={() => setDocsFor(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {historyFor === r.id && canSeePay && <RiderPayPanel riderId={r.id} />}

            {(expanded === r.id || r.approvalStatus === "PENDING") && (
              <div className="mt-4 border-t border-line pt-4">
                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      ["photoUrl", "Photo"],
                      ["cnicUrl", "CNIC front"],
                      ["cnicBackUrl", "CNIC back"],
                      ["licenseUrl", "License"],
                      ["bikeUrl", "Bike"],
                      ["bikeCardUrl", "Bike card"],
                    ] as const
                  ).map(([k, label]) => (
                    <div key={k}>
                      <p className="mb-1 text-[10px] font-bold uppercase text-ink-subtle">{label}</p>
                      <DocThumb url={r[k]} label={label.toLowerCase()} />
                    </div>
                  ))}
                </div>

                {r.approvalStatus === "PENDING" && (
                  <>
                    <p className="mt-4 text-xs font-semibold text-amber-800">
                      Pending — approve after checking documents. Until approved the rider gets no deliveries and
                      can&apos;t be assigned orders.
                    </p>
                    {r.approvalProblems.length > 0 && (
                      <ul className="mt-4 list-disc space-y-0.5 rounded-xl bg-amber-50 py-2 pl-8 pr-3 text-xs text-amber-900">
                        {r.approvalProblems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex"
                        title={r.approvalProblems.length ? `Can't approve: ${r.approvalProblems.join("; ")}` : undefined}
                      >
                        <Button
                          size="sm"
                          disabled={busyId === r.id || r.approvalProblems.length > 0}
                          onClick={() => void approve(r)}
                        >
                          Approve rider
                        </Button>
                      </span>
                      <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void reject(r)}>
                        Reject
                      </Button>
                    </div>
                  </>
                )}
                {r.reviewNotes && <p className="mt-2 text-xs text-ink-muted">Notes: {r.reviewNotes}</p>}
                {r.reviewedBy && <p className="mt-1 text-xs text-ink-subtle">Reviewed by {r.reviewedBy.fullName}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="riders"
      />
    </div>
  );
}
