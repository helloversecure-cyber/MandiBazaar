/**
 * Rider earnings dashboard data — 100% database-driven. Reuses the audited
 * riderEarningsOverview (Delivery.riderFee + RiderPayout) and fixes the period set
 * (today / this week / this month / lifetime). Rider earnings are the accepted
 * delivery bids only; rejected bids never become payable, and the 5% store
 * commission is never deducted from a rider's fee.
 */
import { riderEarningsOverview } from "@/lib/riders/earnings";

export async function riderFinanceDashboard(riderId: string) {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const periods = [
    { key: "today", label: "Today", since: midnight },
    { key: "week", label: "This week", since: weekAgo },
    { key: "month", label: "This month", since: monthStart },
    { key: "lifetime", label: "Lifetime" },
  ];

  const data = await riderEarningsOverview(riderId, periods, {
    page: 1,
    limit: 200,
    payoutPage: 1,
    payoutLimit: 50,
  });

  const period = (k: string) => data.summary.periods.find((p) => p.key === k) ?? { deliveries: 0, earned: 0 };

  return {
    completedDeliveries: data.deliveriesTotal,
    today: period("today").earned,
    thisWeek: period("week").earned,
    thisMonth: period("month").earned,
    lifetime: period("lifetime").earned,
    available: data.summary.unpaid.amount, // eligible / pending earnings
    pendingCount: data.summary.unpaid.count,
    paid: data.summary.paid.amount,
    paidCount: data.summary.paid.count,
    deliveries: data.deliveries,
    payouts: data.payouts,
  };
}
