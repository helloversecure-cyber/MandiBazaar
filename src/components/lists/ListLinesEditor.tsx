"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { COMMON_UNITS, emptyLine, type DraftLine, type LineErrors } from "@/lib/lists/ui";
import { MAX_LIST_LINES } from "@/lib/lists/validation";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; name: string };

const box = "w-full rounded-xl border bg-card px-3 py-2.5 text-sm outline-none focus:ring-2";

/** Editable item lines: name, quantity (decimals allowed), unit, optional category and note. */
export function ListLinesEditor({
  lines,
  onChange,
  errors,
  onClearError,
  categories,
  disabled,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  errors: Record<string, LineErrors>;
  onClearError: (key: string, field: keyof LineErrors) => void;
  categories: CategoryOption[];
  disabled?: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});

  const set = (key: string, field: keyof DraftLine, value: string) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
    if (field in { name: 1, quantity: 1, unit: 1, note: 1, categoryId: 1 }) onClearError(key, field as keyof LineErrors);
  };
  const remove = (key: string) => {
    const next = lines.filter((l) => l.key !== key);
    onChange(next.length ? next : [emptyLine()]);
  };
  const add = () => {
    const l = emptyLine();
    onChange([...lines, l]);
    // Focus the new name box once React has drawn it.
    window.setTimeout(() => document.getElementById(`line-${l.key}-name`)?.focus(), 0);
  };

  return (
    <div>
      <datalist id="list-units">
        {COMMON_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <ol className="space-y-3">
        {lines.map((l, i) => {
          const e = errors[l.key] || {};
          const id = (f: string) => `line-${l.key}-${f}`;
          const showNote = notesOpen[l.key] || !!l.note || !!e.note;
          return (
            <li
              key={l.key}
              data-testid="list-line"
              className={cn(
                "rounded-2xl border bg-card p-3 shadow-card sm:p-4",
                Object.keys(e).length ? "border-red-300" : "border-line"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Item {i + 1}
                  {l.productId ? " · from catalogue" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => remove(l.key)}
                  disabled={disabled}
                  className="inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-deal-600 hover:bg-red-50"
                  aria-label={`Remove item ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Remove</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_96px_110px] sm:gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor={id("name")} className="mb-1 block text-xs font-medium text-ink-muted">
                    Item name<span className="ml-0.5 text-red-600" aria-hidden>*</span>
                  </label>
                  <input
                    id={id("name")}
                    value={l.name}
                    onChange={(ev) => set(l.key, "name", ev.target.value)}
                    placeholder="e.g. Desi ghee, Basmati rice"
                    maxLength={100}
                    disabled={disabled}
                    aria-invalid={!!e.name}
                    aria-describedby={e.name ? id("name-err") : undefined}
                    className={inputClass(!!e.name, box)}
                  />
                  <FieldError id={id("name-err")} message={e.name} />
                </div>
                <div>
                  <label htmlFor={id("quantity")} className="mb-1 block text-xs font-medium text-ink-muted">
                    Quantity<span className="ml-0.5 text-red-600" aria-hidden>*</span>
                  </label>
                  <input
                    id={id("quantity")}
                    value={l.quantity}
                    onChange={(ev) => set(l.key, "quantity", ev.target.value.replace(/[^0-9.,]/g, ""))}
                    inputMode="decimal"
                    placeholder="1.5"
                    maxLength={10}
                    disabled={disabled}
                    aria-invalid={!!e.quantity}
                    aria-describedby={e.quantity ? id("quantity-err") : undefined}
                    className={inputClass(!!e.quantity, box)}
                  />
                  <FieldError id={id("quantity-err")} message={e.quantity} />
                </div>
                <div>
                  <label htmlFor={id("unit")} className="mb-1 block text-xs font-medium text-ink-muted">
                    Unit<span className="ml-0.5 text-red-600" aria-hidden>*</span>
                  </label>
                  <input
                    id={id("unit")}
                    value={l.unit}
                    onChange={(ev) => set(l.key, "unit", ev.target.value)}
                    list="list-units"
                    placeholder="kg"
                    maxLength={20}
                    disabled={disabled}
                    aria-invalid={!!e.unit}
                    aria-describedby={e.unit ? id("unit-err") : undefined}
                    className={inputClass(!!e.unit, box)}
                  />
                  <FieldError id={id("unit-err")} message={e.unit} />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                {categories.length > 0 && (
                  <div>
                    <label htmlFor={id("category")} className="mb-1 block text-xs font-medium text-ink-muted">
                      Category (optional)
                    </label>
                    <select
                      id={id("category")}
                      value={l.categoryId}
                      onChange={(ev) => set(l.key, "categoryId", ev.target.value)}
                      disabled={disabled}
                      className={inputClass(!!e.categoryId, box)}
                    >
                      <option value="">Any category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {showNote ? (
                  <div>
                    <label htmlFor={id("note")} className="mb-1 block text-xs font-medium text-ink-muted">
                      Note for stores (optional)
                    </label>
                    <input
                      id={id("note")}
                      value={l.note}
                      onChange={(ev) => set(l.key, "note", ev.target.value)}
                      placeholder="Brand, size, ripeness…"
                      maxLength={200}
                      disabled={disabled}
                      aria-invalid={!!e.note}
                      className={inputClass(!!e.note, box)}
                    />
                    <FieldError message={e.note} />
                  </div>
                ) : (
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setNotesOpen((s) => ({ ...s, [l.key]: true }))}
                      disabled={disabled}
                      className="inline-flex items-center rounded-lg px-1 py-2 text-xs font-semibold text-brand-600 hover:underline"
                    >
                      + Add a note
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={add}
        disabled={disabled || lines.length >= MAX_LIST_LINES}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-200 bg-card px-4 py-3 text-sm font-semibold text-brand-700 hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add item
      </button>
      {lines.length >= MAX_LIST_LINES && (
        <p className="mt-1 text-center text-xs text-ink-subtle">A list can have at most {MAX_LIST_LINES} items.</p>
      )}
    </div>
  );
}
