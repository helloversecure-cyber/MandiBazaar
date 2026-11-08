"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { useToast } from "@/components/ui/feedback";
import { TempPasswordNotice } from "@/components/admin/TempPasswordNotice";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { staffCreateSchema, STAFF_ROLE_OPTIONS } from "@/lib/admin/form-rules";

type StaffRole = (typeof STAFF_ROLE_OPTIONS)[number];

type StaffUser = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  role: { name: string };
  createdAt: string;
  lastLoginAt?: string | null;
};

const PAGE_SIZE = 25;
const EMPTY = { fullName: "", email: "", phone: "", password: "", role: "ADMIN" as StaffRole };

export default function AdminStaffPage() {
  const toast = useToast();
  const fe = useFieldErrors();
  const [items, setItems] = useState<StaffUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<{ identifier: string; message?: string } | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
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
      const params = new URLSearchParams({ resource: "staff", page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      if (roleFilter) params.set("role", roleFilter);
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (d.success) {
        setItems(d.data.items || []);
        setTotal(d.data.pagination?.total ?? 0);
        setTotalPages(d.data.pagination?.totalPages ?? 1);
      } else toast.error(d.error || "Could not load staff");
    } catch {
      if (my === reqId.current) toast.error("Could not load staff. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    fe.clear(key);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setCreated(null);
    if (!fe.check(staffCreateSchema, form)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "staff", data: form }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        return;
      }
      fe.clear();
      toast.success(`Staff account created for ${data.data.fullName}`);
      setCreated(data.data.loginHint);
      setForm(EMPTY);
      void load();
    } catch {
      fe.setFormError("Could not create the staff account. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const text = (
    key: "fullName" | "email" | "phone" | "password",
    props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }
  ) => {
    const { label, ...rest } = props;
    return (
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">{label}</span>
        <input
          {...rest}
          value={form[key]}
          aria-invalid={fe.has(key)}
          onChange={(e) => set(key, e.target.value)}
          className={inputClass(fe.has(key), "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2")}
        />
        <FieldError message={fe.get(key)} />
      </label>
    );
  };

  return (
    <div>
      <h1 className="font-display text-3xl">Staff</h1>
      <p className="mt-2 text-sm text-ink-subtle">
        Create staff accounts with limited roles instead of sharing the Super Admin login.
      </p>

      <form onSubmit={invite} noValidate className="mt-6 grid gap-3 rounded-3xl bg-card p-5 shadow-card md:grid-cols-2">
        <h2 className="font-semibold text-ink md:col-span-2">Create staff account</h2>
        {text("fullName", { label: "Full name", placeholder: "Ayesha Khan", maxLength: 60 })}
        {text("phone", { label: "Mobile", placeholder: "03001234567", inputMode: "tel", maxLength: 16 })}
        {text("email", { label: "Email (optional)", type: "email", placeholder: "ayesha@gmail.com", maxLength: 100 })}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Role</span>
          <select
            className={inputClass(fe.has("role"), "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2")}
            value={form.role}
            onChange={(e) => set("role", e.target.value as StaffRole)}
          >
            {STAFF_ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <FieldError message={fe.get("role")} />
        </label>
        <div className="md:col-span-2">
          {text("password", {
            label: "Temporary password (optional)",
            type: "password",
            autoComplete: "new-password",
            maxLength: 64,
            placeholder: "Leave blank to generate a random one",
          })}
          <p className="mt-1 text-xs text-ink-subtle">
            8–64 characters with a letter and a number. They must change it on first login.
          </p>
        </div>
        <div className="md:col-span-2">
          <FormError message={fe.formError} />
          <Button type="submit" size="sm" className="mt-2" disabled={busy}>
            {busy ? "Creating…" : "Create staff account"}
          </Button>
        </div>
      </form>

      {created && (
        <TempPasswordNotice
          identifier={created.identifier}
          message={created.message}
          onDismiss={() => setCreated(null)}
        />
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
          className="rounded-full border px-3 py-2 text-sm"
        >
          <option value="">All roles</option>
          {STAFF_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone or email…"
          aria-label="Search staff"
          className="w-full rounded-full border px-4 py-2 text-sm sm:w-72"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-brand-50 dark:bg-brand-500/10">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3">
                  <p>{u.phone || "—"}</p>
                  <p className="text-xs text-ink-subtle">{u.email || ""}</p>
                </td>
                <td className="px-4 py-3">{u.role?.name?.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">
                  {u.isActive ? "Active" : "Inactive"}
                  {u.mustChangePassword && (
                    <span className="block text-xs text-amber-700">Temporary password not changed yet</span>
                  )}
                </td>
                <td className="px-4 py-3">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {!loading && !items.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-subtle">
                  {query || roleFilter ? "No staff match this search." : "No staff accounts yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} itemLabel="staff" />
    </div>
  );
}
