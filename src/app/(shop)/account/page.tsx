"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Package, MapPin, Heart, Star, ArrowRight } from "lucide-react";

export default function AccountPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<
    { orderNumber: string; createdAt: string; grandTotal: number; orderStatus: string; remainingAmount: number }[]
  >([]);

  useEffect(() => {
    fetch("/api/orders?limit=5")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setOrders(d.data.items);
      });
  }, []);

  const quickLinks = [
    { href: "/account/orders", label: "Orders", icon: Package, desc: "Track & reorder" },
    { href: "/account/addresses", label: "Addresses", icon: MapPin, desc: "Delivery locations" },
    { href: "/wishlist", label: "Wishlist", icon: Heart, desc: "Saved products" },
    { href: "/account/reviews", label: "Reviews", icon: Star, desc: "Your feedback" },
  ];

  return (
    <div>
      <PageHeader
        title={`Hello, ${session?.user?.name?.split(" ")[0] || "there"}!`}
        subtitle="Manage your orders, addresses, and saved items"
        badge="My account"
      />


      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quickLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group rounded-2xl border border-line bg-card p-4 shadow-card transition hover:border-brand-200 hover:shadow-card-hover"
          >
            <l.icon className="h-5 w-5 text-brand-600" />
            <p className="mt-2 font-bold text-ink">{l.label}</p>
            <p className="text-xs text-ink-subtle">{l.desc}</p>
          </Link>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-bold text-ink">Recent orders</h2>
          <Link
            href="/account/orders"
            className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            View all
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-app text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-3 font-semibold">Order #</th>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderNumber} className="border-t border-line">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/account/orders/${o.orderNumber}`}
                      className="font-semibold text-brand-600 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-ink-muted">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-ink">
                    {formatCurrency(o.grandTotal)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                      {o.orderStatus.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-ink-subtle">
                    No orders yet.{" "}
                    <Link href="/products" className="font-semibold text-brand-600">
                      Start shopping
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
