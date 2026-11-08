import { z } from "zod";
import * as pkRules from "@/lib/validators/pk";

/** Customer / owner / rider account fields (QA L1, S1). Phone saved as 03XXXXXXXXX, email lower-case. */
export const registerSchema = z.object({
  fullName: pkRules.zPersonName,
  phone: pkRules.zMobile,
  // Email is required now: it is the login id and is verified via Firebase.
  email: pkRules.zEmail,
  password: pkRules.zPassword,
});

/**
 * Delivery address (QA M2 / S6). Also embedded in checkoutSchema — field names and
 * output shape are unchanged (strings, optional extras, latitude/longitude number|undefined).
 */
export const addressSchema = z.object({
  label: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v : "Home"),
    pkRules.zText(30, "Label", 1)
  ),
  fullName: pkRules.zPersonName,
  phone: pkRules.zMobile,
  houseBuilding: pkRules.zAddressLine("House / Building"),
  street: pkRules.optional(pkRules.zAddressLine("Street")),
  area: pkRules.zAddressLine("Area"),
  city: pkRules.zCity,
  province: pkRules.zProvince,
  postalCode: pkRules.optional(pkRules.zPostalCode),
  nearbyLandmark: pkRules.optional(pkRules.zText(120, "Nearby landmark")),
  deliveryInstructions: pkRules.optional(pkRules.zText(500, "Delivery instructions")),
  latitude: pkRules.optional(pkRules.zLatitude),
  longitude: pkRules.optional(pkRules.zLongitude),
  isDefault: z.boolean().optional(),
});

export const cartItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  quantity: z
    .number({ message: "Quantity must be a whole number from 1 to 100" })
    .int({ message: "Quantity must be a whole number from 1 to 100" })
    .min(1, { message: "Quantity must be a whole number from 1 to 100" })
    .max(100, { message: "Quantity must be a whole number from 1 to 100" }),
  /** Guest-cart merge: lower the quantity to the available stock instead of failing */
  capToStock: z.boolean().optional(),
});

export const checkoutSchema = z
  .object({
    // Empty string → undefined so refine can require a real address cleanly
    addressId: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().min(1).optional()
    ),
    address: addressSchema.optional(),
    couponCode: z.string().trim().max(30, { message: "Coupon code is too long" }).optional(),
    /**
     * Product payment: ONLINE (Stripe/JazzCash), JAZZCASH alias, COD (products in
     * cash, delivery fee online) or FULL_COD (products + delivery fee in cash —
     * small orders only; the server re-checks eligibility).
     */
    productPaymentChoice: z.enum([
      "ONLINE",
      "STRIPE",
      "JAZZCASH",
      "CASH_ON_DELIVERY",
      "FULL_COD",
    ]),
    /** Online gateway when fee/products need online pay. Stripe default if omitted. */
    onlineProvider: z.enum(["STRIPE", "JAZZCASH_QR"]).optional(),
    notes: z.string().max(500).optional(),
    idempotencyKey: z.string().min(8).max(64),
  })
  .refine((d) => Boolean(d.addressId) || Boolean(d.address), {
    message: "Delivery address is required",
    path: ["addressId"],
  });

export const productSchema = z
  .object({
    // QA N3/S9 limits (store portal uses src/lib/validators/product-rules.ts)
    name: z.string().trim().min(2, "Product name must be 2–80 characters").max(80, "Product name must be 2–80 characters"),
    sku: z.string().min(2).max(50),
    categoryId: z.string().min(1),
    description: z.string().max(2000, "Description can be at most 2,000 characters").optional(),
    shortDescription: z.string().max(300).optional(),
    price: z.number().int("Price must be whole rupees").min(1).max(1_000_000, "Price can be at most Rs 1,000,000"),
    salePrice: z.number().int("Deal price must be whole rupees").min(1).max(1_000_000).optional().nullable(),
    costPrice: z.number().positive().optional().nullable(),
    unit: z.string().min(1),
    weight: z.number().optional().nullable(),
    stockQuantity: z.number().int().min(0).max(100_000, "Stock can be at most 100,000"),
    lowStockThreshold: z.number().int().min(0).default(5),
    isOrganic: z.boolean().default(true),
    isFarmProduct: z.boolean().default(true),
    freeDelivery: z.boolean().default(false),
    isFeatured: z.boolean().default(false),
    isBestSeller: z.boolean().default(false),
    isNewArrival: z.boolean().default(false),
    isSeasonal: z.boolean().default(false),
    farmSourceInfo: z.string().optional(),
    ingredients: z.string().optional(),
    nutritionInfo: z.string().optional(),
    tags: z.array(z.string()).default([]),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).default("DRAFT"),
  })
  .refine(
    (d) => d.salePrice == null || d.salePrice < d.price,
    { message: "Deal price must be lower than regular price", path: ["salePrice"] }
  );

// categorySchema (owner: D2) — QA P11 / S13: S0 name rule, image needed to be active.
import { zCategoryName as zCategoryNameRule } from "@/lib/validators/pk";
import {
  CATEGORY_IMAGE_REQUIRED_MSG,
  isAllowedCategoryImageUrl,
} from "@/lib/catalog/category-rules";

export const categorySchema = z
  .object({
    name: zCategoryNameRule,
    description: z
      .string()
      .max(500, { message: "Description can be at most 500 characters" })
      .optional()
      .nullable(),
    // Local `/uploads/...` or remote https URLs (not strict .url() — uploads are relative)
    imageUrl: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .nullable()
      .refine((v) => !v || isAllowedCategoryImageUrl(v), {
        message: "Upload an image or use a link starting with https://",
      }),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .refine((d) => !d.isActive || Boolean(d.imageUrl), {
    message: CATEGORY_IMAGE_REQUIRED_MSG,
    path: ["imageUrl"],
  });

/** Coupon create/edit rules (QA T1–T3) live with the coupon logic; re-exported here. */
export { couponDefinitionSchema as couponSchema } from "@/lib/orders/coupon-rules";

/** QA S16: product review form (only after a delivered order). */
export const reviewSchema = z.object({
  productId: z.string().min(1),
  orderId: z.string().min(1),
  rating: z.coerce
    .number({ message: "Choose a rating from 1 to 5 stars" })
    .int({ message: "Choose a rating from 1 to 5 stars" })
    .min(1, { message: "Choose a rating from 1 to 5 stars" })
    .max(5, { message: "Choose a rating from 1 to 5 stars" }),
  comment: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(1000, { message: "Review can be at most 1,000 characters" }).optional()
  ),
  imageUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .refine(
        (u) => (u.startsWith("/uploads/") && u.length > 9) || /^https:\/\/[^\s/]+\/\S+$/i.test(u),
        { message: "Photo must be an uploaded image" }
      )
      .optional()
  ),
});
