import { RoleName } from "@prisma/client";

export const PERMISSIONS = {
  PRODUCTS_READ: "products:read",
  PRODUCTS_WRITE: "products:write",
  ORDERS_READ: "orders:read",
  ORDERS_WRITE: "orders:write",
  PAYMENTS_READ: "payments:read",
  PAYMENTS_WRITE: "payments:write",
  CUSTOMERS_READ: "customers:read",
  CUSTOMERS_WRITE: "customers:write",
  INVENTORY_READ: "inventory:read",
  INVENTORY_WRITE: "inventory:write",
  REPORTS_READ: "reports:read",
  SETTINGS_WRITE: "settings:write",
  COUPONS_WRITE: "coupons:write",
  REVIEWS_WRITE: "reviews:write",
  RIDERS_WRITE: "riders:write",
  AUDIT_READ: "audit:read",
  REFUNDS_WRITE: "refunds:write",
  STORES_READ: "stores:read",
  STORES_WRITE: "stores:write",
  STORES_APPROVE: "stores:approve",
  PAYOUTS_READ: "payouts:read",
  PAYOUTS_WRITE: "payouts:write",
  REMITTANCES_WRITE: "remittances:write",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleName, PermissionCode[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS),
  ADMIN: Object.values(PERMISSIONS).filter(
    (p) => p !== PERMISSIONS.SETTINGS_WRITE && p !== PERMISSIONS.STORES_APPROVE
  ),
  ORDER_MANAGER: [
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.RIDERS_WRITE,
    PERMISSIONS.STORES_READ,
  ],
  INVENTORY_MANAGER: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.PRODUCTS_WRITE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
  ],
  DELIVERY_MANAGER: [
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.RIDERS_WRITE,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.REMITTANCES_WRITE,
  ],
  STORE_OWNER: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.PRODUCTS_WRITE,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.PAYOUTS_READ,
  ],
  CUSTOMER: [],
  RIDER: [
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.REMITTANCES_WRITE,
  ],
};

export function isRiderRole(role: RoleName): boolean {
  return role === "RIDER";
}

export function hasPermission(
  role: RoleName,
  permission: PermissionCode
): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isPlatformAdminRole(role: RoleName): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "ORDER_MANAGER" ||
    role === "INVENTORY_MANAGER" ||
    role === "DELIVERY_MANAGER"
  );
}

/** @deprecated use isPlatformAdminRole */
export function isAdminRole(role: RoleName): boolean {
  return isPlatformAdminRole(role);
}

export function isStorePortalRole(role: RoleName): boolean {
  return role === "STORE_OWNER" || role === "SUPER_ADMIN";
}
