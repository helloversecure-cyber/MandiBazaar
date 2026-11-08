export type OnboardingStep = {
  emoji: string;
  title: string;
  description: string;
  bullets?: string[];
  link?: { href: string; label: string };
  tip?: string;
};

export type OnboardingFlowConfig = {
  title: string;
  subtitle: string;
  finishLabel: string;
  steps: OnboardingStep[];
};

export const ROLE_ONBOARDING_PATH: Record<string, string> = {
  SUPER_ADMIN: "admin",
  ADMIN: "admin",
  ORDER_MANAGER: "admin",
  INVENTORY_MANAGER: "admin",
  DELIVERY_MANAGER: "admin",
  STORE_OWNER: "store",
  CUSTOMER: "customer",
  RIDER: "rider",
};

export const ROLE_DEFAULT_DEST: Record<string, string> = {
  SUPER_ADMIN: "/admin",
  ADMIN: "/admin",
  ORDER_MANAGER: "/admin",
  INVENTORY_MANAGER: "/admin",
  DELIVERY_MANAGER: "/admin",
  STORE_OWNER: "/store-portal",
  CUSTOMER: "/products",
  RIDER: "/rider-portal",
};

export const CUSTOMER_ONBOARDING: OnboardingFlowConfig = {
  title: "Customer onboarding",
  subtitle: "MandiBazaar shopper guide",
  finishLabel: "Start shopping",
  steps: [
    {
      emoji: "🛒",
      title: "Welcome to MandiBazaar",
      description:
        "Pakistan's multi-store marketplace — shop from local mandi stores in one place.",
      bullets: [
        "Fresh groceries, electronics, and daily essentials",
        "Multiple stores in a single cart",
        "Best deals from stores in your city",
      ],
    },
    {
      emoji: "🔍",
      title: "Browse & discover",
      description: "Finding and comparing products is simple.",
      bullets: [
        "Homepage categories, flash deals, and product rails",
        "Search by product or store",
        "Save items to your wishlist",
        "See organic/inorganic, price, and stock on product pages",
      ],
      link: { href: "/products", label: "Browse products" },
    },
    {
      emoji: "🛍️",
      title: "Cart & checkout",
      description: "Add items from different stores into one cart.",
      bullets: [
        "Each store subtotal is shown separately",
        "Save delivery addresses in your account",
        "Apply coupons at checkout (e.g. FRESH10, WELCOME200)",
        "Add order notes if needed",
      ],
      link: { href: "/cart", label: "View cart" },
    },
    {
      emoji: "💳",
      title: "Payment rules",
      description: "Two separate payments — delivery fee and product amount.",
      bullets: [
        "Delivery fee: always paid online via JazzCash (from Rs. 10/km)",
        "Product amount: JazzCash online or cash to the rider on delivery",
        "For COD, pay the rider the exact remaining amount",
        "For online payments, the rider may collect a payment screenshot",
      ],
      tip: "Delivery fees go to the platform. Product amounts go to store owners after commission.",
    },
    {
      emoji: "📦",
      title: "Orders & tracking",
      description: "Track every step after you place an order.",
      bullets: [
        "Open Account → Orders to see status",
        "Confirmed → Processing → Packed → Out for delivery → Delivered",
        "Cancellations and refunds are handled through support/admin",
        "Leave a review after delivery",
      ],
      link: { href: "/account/orders", label: "My orders" },
    },
    {
      emoji: "👤",
      title: "Your account",
      description: "Manage your profile and settings.",
      bullets: [
        "Add and edit addresses",
        "View order history and reviews",
        "Sign in with phone or email",
        "Apply to open your own store from the Sell page",
      ],
      link: { href: "/account", label: "My account" },
    },
    {
      emoji: "✅",
      title: "You're all set!",
      description: "Start shopping — don't miss today's deals.",
      bullets: [
        "Check flash deals and homepage rails",
        "Try a multi-store cart",
        "Add notes on checkout if you need special instructions",
      ],
      link: { href: "/", label: "Go to homepage" },
    },
  ],
};

export const STORE_ONBOARDING: OnboardingFlowConfig = {
  title: "Store owner onboarding",
  subtitle: "Seller guide — MandiBazaar",
  finishLabel: "Go to store portal",
  steps: [
    {
      emoji: "🏪",
      title: "Welcome, store owner!",
      description:
        "MandiBazaar helps your store reach customers across the city.",
      bullets: [
        "List your mandi or shop online",
        "Manage orders, products, and payouts from one portal",
        "Platform riders handle delivery",
      ],
    },
    {
      emoji: "📝",
      title: "Apply to open a store",
      description: "Submit an application first — MandiBazaar must approve it.",
      bullets: [
        "Complete the form on the /store page (Create store tab)",
        "Upload CNIC front and back photos",
        "Upload shop or warehouse photo",
        "Upload address proof",
        "Add bank or JazzCash details for payouts",
      ],
      link: { href: "/store?tab=signup", label: "Apply to sell" },
      tip: "Weekly payouts may be skipped if bank or JazzCash details are missing.",
    },
    {
      emoji: "✅",
      title: "Approval process",
      description: "MandiBazaar verifies your documents.",
      bullets: [
        "CNIC, shop photo, and address are reviewed",
        "Once approved, your store goes live",
        "If rejected, fix the details and apply again",
        "Status flow: Pending → Approved",
      ],
    },
    {
      emoji: "📦",
      title: "List your products",
      description: "Manage inventory from Store portal → Products.",
      bullets: [
        "Upload a product photo (required)",
        "Add a description — quality, packaging, ingredients",
        "Mark each item organic or inorganic",
        "Set price, sale price, unit, and stock",
        "Keep stock updated to avoid order issues",
      ],
      link: { href: "/store-portal/products", label: "Add products" },
    },
    {
      emoji: "📋",
      title: "Handle orders",
      description: "Pack customer orders on time.",
      bullets: [
        "New order → Confirm → Processing → Pack",
        "Mark Ready for Dispatch when ready for pickup",
        "The platform then assigns a rider",
        "You only pack items from your own store",
      ],
      link: { href: "/store-portal/orders", label: "Store orders" },
    },
    {
      emoji: "💰",
      title: "Payouts & commission",
      description: "You are paid weekly after platform commission.",
      bullets: [
        "Net payout = Gross sales − Commission (default 10%)",
        "Delivery fees stay with the platform",
        "Payouts are sent via JazzCash or bank transfer",
        "Check history under Store portal → Payouts",
        "Keep bank/JazzCash details updated in settings",
      ],
      link: { href: "/store-portal/payouts", label: "View payouts" },
    },
    {
      emoji: "⚙️",
      title: "Store profile",
      description: "Update logo, description, and payment details.",
      bullets: [
        "Store name, phone, and description",
        "Logo upload",
        "Bank account title, IBAN, and account number",
        "JazzCash number and account title",
        "Google Maps / location",
      ],
      link: { href: "/store-portal/settings", label: "Store settings" },
    },
    {
      emoji: "🚀",
      title: "Ready to sell!",
      description: "Open the portal and add your first product.",
      bullets: [
        "Login / signup: /store",
        "Products stay offline until your store is approved",
        "Wait for MandiBazaar approval if your application is still pending",
      ],
    },
  ],
};

export const ADMIN_ONBOARDING: OnboardingFlowConfig = {
  title: "MandiBazaar onboarding",
  subtitle: "Platform control centre",
  finishLabel: "Open admin panel",
  steps: [
    {
      emoji: "⚙️",
      title: "Dashboard overview",
      description: "Control the full MandiBazaar platform from here.",
      bullets: [
        "Sales, orders, stores, and payments summary",
        "Quick links to every module",
        "Login: /login?portal=admin",
      ],
      link: { href: "/admin", label: "Admin dashboard" },
    },
    {
      emoji: "🏪",
      title: "Store approvals",
      description: "Verify new sellers before they go live.",
      bullets: [
        "Review the pending applications queue",
        "Check CNIC, shop/warehouse photo, and address proof",
        "Approve or reject with a reason",
        "Set a commission override per store if needed",
      ],
      link: { href: "/admin/stores", label: "Manage stores" },
    },
    {
      emoji: "📦",
      title: "Products & inventory",
      description: "Manage the platform-wide catalog.",
      bullets: [
        "View and edit products across all stores",
        "Create categories",
        "Adjust inventory",
        "Manage archived products",
      ],
      link: { href: "/admin/products", label: "All products" },
    },
    {
      emoji: "🛵",
      title: "Orders & riders",
      description: "End-to-end delivery operations.",
      bullets: [
        "Change order status from the orders list",
        "Assign riders to ready orders",
        "Track out-for-delivery through delivered",
        "Riders sign up with CNIC front & back, photo, license, bike, bike card, and account number",
        "Approve or reject pending riders under /admin/riders",
      ],
      link: { href: "/admin/riders", label: "Review riders" },
    },
    {
      emoji: "💵",
      title: "COD & rider remittances",
      description: "Control rider cash flow.",
      bullets: [
        "Riders collect COD on delivery",
        "Riders mark cash submitted under Cash to Admin",
        "Confirm when you physically receive the cash",
        "Statuses: Pending → Submitted → Received",
      ],
      link: { href: "/admin/payouts", label: "Remittances" },
    },
    {
      emoji: "📸",
      title: "Online payment proofs",
      description: "When the customer already paid online.",
      bullets: [
        "Riders upload the customer's payment screenshot",
        "Review proofs under Admin → Payments",
        "Approve or reject with a reason",
        "Rejected proofs must be re-uploaded by the rider",
      ],
      link: { href: "/admin/payments", label: "Payment proofs" },
    },
    {
      emoji: "💸",
      title: "Store payouts (1-click)",
      description: "Pay stores after deducting commission.",
      bullets: [
        "Pay all stores (1 click) — calculate sales, cut commission, mark paid",
        "JazzCash preferred, then bank transfer",
        "Stores missing payment details are skipped",
        "Delivery fees stay with the platform",
        "A batch reference is saved on each payout",
      ],
      link: { href: "/admin/payouts", label: "Store payouts" },
    },
    {
      emoji: "🎫",
      title: "Coupons, customers & more",
      description: "Other platform tools.",
      bullets: [
        "Create coupons (FRESH10, WELCOME200, etc.)",
        "View customers and order history",
        "Refunds, reviews, and reports",
        "Audit logs track every action",
        "Platform settings (commission %, etc.)",
      ],
      link: { href: "/admin/coupons", label: "Coupons" },
    },
    {
      emoji: "🎯",
      title: "Daily checklist",
      description: "Review these items every day.",
      bullets: [
        "1) Pending store approvals",
        "2) Orders needing rider assignment",
        "3) Pending rider remittances",
        "4) Payment proofs to review",
        "5) Weekly store payouts",
      ],
    },
  ],
};

export const RIDER_ONBOARDING: OnboardingFlowConfig = {
  title: "Rider onboarding",
  subtitle: "Delivery & remittance guide",
  finishLabel: "Open rider portal",
  steps: [
    {
      emoji: "🧾",
      title: "Documents for MandiBazaar",
      description:
        "Signup requires your CNIC front & back, photo, license, bike photo, bike card, and account number. These are reviewed on /admin/riders and you must be approved before you receive deliveries.",
    },
    {
      emoji: "🛵",
      title: "Welcome, rider!",
      description:
        "You are a MandiBazaar delivery partner — pick up from stores and deliver to customers.",
      bullets: [
        "Signup: /register/rider (photos + account number required)",
        "Login: /login?portal=rider",
      ],
      link: { href: "/login?portal=rider", label: "Rider login" },
    },
    {
      emoji: "📱",
      title: "Your portal",
      description: "Three main sections — everything starts here.",
      bullets: [
        "Dashboard: active jobs, pending cash, availability status",
        "Deliveries: assigned orders list",
        "Cash to Admin: submit COD remittances",
        "Set status: Available / Busy / Offline",
      ],
      link: { href: "/rider-portal", label: "Rider dashboard" },
    },
    {
      emoji: "📦",
      title: "Delivery workflow",
      description: "Step-by-step flow for every order.",
      bullets: [
        "1) MandiBazaar assigns you an order",
        "2) Pick up from the listed store addresses (multiple stores possible)",
        "3) Tap 'Picked up — start delivery'",
        "4) Go to the customer address",
        "5) Tap 'Mark delivered'",
        "If delivery fails, enter a reason and mark failed",
      ],
      link: { href: "/rider-portal/deliveries", label: "My deliveries" },
    },
    {
      emoji: "💵",
      title: "COD collection",
      description: "Collect the exact amount for cash-on-delivery orders.",
      bullets: [
        "The COD amount is shown clearly on the order",
        "Collect the full remaining amount from the customer",
        "Cash is recorded automatically when you mark delivered",
        "Do not collect the wrong amount — the system validates it",
      ],
      tip: "COD cash is with you until you submit it to MandiBazaar.",
    },
    {
      emoji: "📸",
      title: "Online payment proof",
      description: "When the customer already paid online.",
      bullets: [
        "Orders show 'Online paid — screenshot required'",
        "Take a JazzCash/payment screenshot from the customer's phone",
        "Upload it from the deliveries page",
        "You cannot mark delivered without the upload",
        "MandiBazaar approves or rejects the proof",
      ],
    },
    {
      emoji: "🏦",
      title: "Submit cash to MandiBazaar",
      description: "COD cash must be handed to the platform.",
      bullets: [
        "Open the Cash to Admin page",
        "Tap 'I submitted cash to Admin' for each order",
        "Status: Pending → Submitted → Received (admin confirms)",
        "Do not keep overnight COD without submitting",
        "Contact admin if a remittance is disputed",
      ],
      link: { href: "/rider-portal/remittances", label: "Submit cash" },
    },
    {
      emoji: "⚠️",
      title: "Important rules",
      description: "Follow these rules on every job.",
      bullets: [
        "Handle only orders assigned to you",
        "Inactive accounts cannot log in for deliveries",
        "Treat customers professionally",
        "Verify goods at pickup with the store",
        "Follow screenshot and remittance rules",
      ],
    },
    {
      emoji: "✅",
      title: "Ready to deliver!",
      description: "Stay Available and wait for assignments.",
      bullets: [
        "MandiBazaar assigns jobs — you will be notified",
        "Finish active deliveries before taking new ones",
        "Contact admin if you run into problems",
      ],
    },
  ],
};

export function getOnboardingConfig(role: string): OnboardingFlowConfig | null {
  const path = ROLE_ONBOARDING_PATH[role];
  if (path === "customer") return CUSTOMER_ONBOARDING;
  if (path === "store") return STORE_ONBOARDING;
  if (path === "admin") return ADMIN_ONBOARDING;
  if (path === "rider") return RIDER_ONBOARDING;
  return null;
}

export function getOnboardingSlug(role: string): string {
  return ROLE_ONBOARDING_PATH[role] || "customer";
}

export function getDefaultDest(role: string): string {
  return ROLE_DEFAULT_DEST[role] || "/products";
}
