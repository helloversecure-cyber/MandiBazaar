/** Customer "My orders" filters (QA R8). Pure — shared by API and page. */
export const CUSTOMER_ORDER_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export type CustomerOrderFilter = (typeof CUSTOMER_ORDER_FILTERS)[number]["key"];

export const ACTIVE_ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
  "ASSIGNED_TO_RIDER",
  "OUT_FOR_DELIVERY",
];
export const CLOSED_ORDER_STATUSES = ["CANCELLED", "FAILED", "RETURNED"];

export function isCustomerOrderFilter(v: unknown): v is CustomerOrderFilter {
  return CUSTOMER_ORDER_FILTERS.some((f) => f.key === v);
}

export function customerOrderFilterWhere(f: CustomerOrderFilter): Record<string, unknown> {
  if (f === "active") return { orderStatus: { in: ACTIVE_ORDER_STATUSES } };
  if (f === "delivered") return { orderStatus: "DELIVERED" };
  if (f === "cancelled") return { orderStatus: { in: CLOSED_ORDER_STATUSES } };
  return {};
}
