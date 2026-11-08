"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  type?: string;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setItems(d.data.items || []);
          setUnread(d.data.unread || 0);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function markRead(id: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "MARK_ALL_READ" }),
    });
    load();
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "All caught up"}
        badge="Alerts"
        action={
          unread > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {loading && (
        <p className="py-8 text-center text-sm text-ink-subtle">Loading…</p>
      )}

      {!loading && !items.length && (
        <div className="rounded-2xl border border-dashed border-line py-12 text-center">
          <Bell className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-ink-subtle">No notifications yet</p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => !n.read && markRead(n.id)}
            className={cn(
              "w-full rounded-2xl border p-4 text-left shadow-card transition",
              n.read
                ? "border-line bg-card"
                : "border-brand-100 bg-brand-50/60"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">{n.title}</p>
                <p className="mt-1 text-sm text-ink-muted">{n.body}</p>
                <p className="mt-2 text-xs text-ink-subtle">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              {!n.read && (
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
