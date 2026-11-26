/** Input rules for a customer's item list (test cases B-02 … B-04, B-13). */
import { z } from "zod";

export const MAX_LIST_LINES = 100;

const text = (max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`));

const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer`))
    .optional()
    .nullable()
    // undefined stays undefined (field not sent: keep the current value on edits);
    // "" or null becomes null (clear it).
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const listLineSchema = z.object({
  /** Existing line id (edits only). */
  id: z.string().min(1).max(40).optional(),
  name: text(100, "Item name"),
  quantity: z.coerce
    .number({ error: "Enter a quantity" })
    .refine((n) => Number.isFinite(n), "Enter a quantity")
    .refine((n) => n > 0, "Quantity must be more than 0")
    .refine((n) => n <= 100000, "Quantity is too large")
    .transform((n) => Math.round(n * 1000) / 1000),
  unit: text(20, "Unit"),
  categoryId: z.string().min(1).max(40).optional().nullable(),
  productId: z.string().min(1).max(40).optional().nullable(),
  note: optionalText(200, "Item note"),
});

const lines = z
  .array(listLineSchema, { error: "Add at least one item" })
  .min(1, "Add at least one item")
  .max(MAX_LIST_LINES, `A list can have at most ${MAX_LIST_LINES} items`);

export const createListSchema = z.object({
  addressId: z.string({ error: "Choose a delivery address" }).min(1, "Choose a delivery address").max(40),
  note: optionalText(300, "Note"),
  lines,
});

export const updateListSchema = z
  .object({
    note: optionalText(300, "Note"),
    lines: lines.optional(),
  })
  .refine((v) => v.note !== undefined || v.lines !== undefined, "Nothing to update");

export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
export type ListLineInput = z.infer<typeof listLineSchema>;

/** First validation message, plus a field path like "lines.2.quantity". */
export function firstIssue(err: z.ZodError): { message: string; field: string } {
  const i = err.issues[0];
  return { message: i?.message || "Invalid input", field: (i?.path || []).join(".") };
}
