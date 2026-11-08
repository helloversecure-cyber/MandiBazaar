"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/feedback";

type Log = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  previousValue: unknown;
  newValue: unknown;
  user: { fullName: string; email: string | null; phone: string | null } | null;
};

const PAGE_SIZE = 25;

function json(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function AdminAuditLogsPage() {
  const toast = useToast();
  const [items, setItems] = useState<Log[]>([]);
  const [actions, setActions] = useState<{ action: string; count: number }[]>([]);
  const [action, setAction] = useState("");
  const [userQ, setUserQ] = useState("");
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const reqId = useRef(0);
  const firstLoad = useRef(true);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setUser(userQ.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [userQ]);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ resource: "audit", page: String(page), limit: String(PAGE_SIZE) });
      if (action) params.set("action", action);
      if (user) params.set("user", user);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (firstLoad.current) params.set("actions", "1");
      const res = await fetch(`/api/admin?${params}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (!d.success) {
        toast.error(d.error || "Could not load audit logs");
        return;
      }
      setItems(d.data.items);
      setTotal(d.data.pagination?.total ?? 0);
      setTotalPages(d.data.pagination?.totalPages ?? 1);
      if (d.data.actions) {
        setActions(d.data.actions);
        firstLoad.current = false;
      }
    } catch {
      if (my === reqId.current) toast.error("Could not load audit logs. Check your connection.");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, action, user, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = Boolean(action || user || from || to);

  return (
    <div>
      <h1 className="font-display text-3xl">Audit logs</h1>

      <div className="mt-4 grid gap-2 rounded-2xl bg-card p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Action</span>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action.replace(/_/g, " ").toLowerCase()} ({a.count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-muted">User (name, email or phone)</span>
          <input
            type="search"
            value={userQ}
            onChange={(e) => setUserQ(e.target.value)}
            placeholder='e.g. Ali, or "system"'
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-muted">From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-muted">To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setAction("");
              setUserQ("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
            className="justify-self-start text-xs font-semibold text-leaf-700 underline sm:col-span-2 lg:col-span-4"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-6 space-y-2">
        {items.map((log) => {
          const hasDetail = log.previousValue != null || log.newValue != null;
          return (
            <div key={log.id} className="rounded-2xl bg-card px-4 py-3 text-sm shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all font-medium">
                    {log.action} · {log.entity} {log.entityId}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {log.user?.fullName || "System"} · {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
                {hasDetail && (
                  <button
                    type="button"
                    onClick={() => setOpen(open === log.id ? null : log.id)}
                    className="text-xs font-semibold text-leaf-700"
                  >
                    {open === log.id ? "Hide details" : "Details"}
                  </button>
                )}
              </div>
              {open === log.id && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-ink-subtle">Before</p>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-brand-50 dark:bg-brand-500/10 p-2 text-xs">
                      {log.previousValue == null ? "—" : json(log.previousValue)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-ink-subtle">After</p>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-brand-50 dark:bg-brand-500/10 p-2 text-xs">
                      {log.newValue == null ? "—" : json(log.newValue)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!loading && !items.length && (
          <p className="text-ink-subtle">{filtered ? "No audit entries match these filters." : "No audit entries yet."}</p>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} itemLabel="entries" />
    </div>
  );
}
