/** JSON shapes of the list APIs as the browser receives them (dates are strings). */

export type ListLine = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  categoryId: string | null;
  productId: string | null;
  note: string | null;
};

export type ListAddress = {
  label?: string | null;
  fullName?: string | null;
  phone?: string | null;
  houseBuilding?: string | null;
  street?: string | null;
  area?: string | null;
  city?: string | null;
  province?: string | null;
  latitude?: number | null;
  longitude?: number | null;
} | null;

export type ListSummary = {
  id: string;
  status: "BIDDING" | "ACCEPTED" | "CANCELLED" | "NO_STORES" | "EXPIRED";
  city: string | null;
  note: string | null;
  noPin: boolean;
  radiusKm: number;
  version: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  address: ListAddress;
  orderNumber: string | null;
  offerCount: number;
  lines: ListLine[];
};

export type Offer = {
  bidId: string;
  status: "PENDING" | "ACCEPTED" | "NOT_SELECTED";
  acceptable: boolean;
  needsUpdate: boolean;
  store: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    area: string | null;
    city: string;
    rating: number | null;
    ratingCount: number;
  };
  distanceKm: number | null;
  itemsTotal: number;
  discount: number;
  total: number;
  coveredCount: number;
  lineCount: number;
  fullCoverage: boolean;
  missingItems: string[];
  prepMinutes: number | null;
  note: string | null;
  estimatedDeliveryFee: number | null;
  tags: ("LOWEST_PRICE" | "FASTEST")[];
  submittedAt: string;
  updatedAt: string;
  lines: {
    lineId: string;
    name: string;
    quantity: number;
    unit: string;
    available: boolean;
    unitPrice: number | null;
    lineTotal: number | null;
  }[];
};

export type ListDetail = ListSummary & { offers: Offer[] };

export type SavedAddress = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  houseBuilding: string;
  street?: string | null;
  area: string;
  city: string;
  province: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
};

export type RiderBidsView = {
  orderNumber: string;
  orderStatus: string;
  deliveryFee: number | null;
  grandTotal: number;
  remainingAmount: number;
  deliveryFeePaymentStatus: string;
  request: {
    id: string;
    status: "OPEN" | "ASSIGNED" | "EXPIRED" | "NO_BIDS" | "CANCELLED";
    expiresAt: string;
    reopenCount: number;
    biddingOpen: boolean;
    needsAdmin: boolean;
  } | null;
  bids: {
    id: string;
    amount: number;
    status: "PENDING" | "ACCEPTED";
    note: string | null;
    createdAt: string;
    rider: {
      name: string;
      vehicleType: string | null;
      photoUrl: string | null;
      completedDeliveries: number;
      rating: number | null;
    };
  }[];
  assignedRider: { name: string; phone: string; vehicleType: string | null; photoUrl: string | null } | null;
};
