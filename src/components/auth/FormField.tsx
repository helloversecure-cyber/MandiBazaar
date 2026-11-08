"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { PasswordInput } from "@/components/ui/PasswordInput";

const BASE =
  "w-full rounded-xl border bg-slate-50 px-4 py-3 text-sm outline-none focus:bg-white focus:ring-2";

type Common = {
  name: string;
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
};

/** Labelled input with a hint and a red message under it (QA S0: errors under the field). */
export function TextField({
  name,
  label,
  required,
  hint,
  error,
  ...input
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = `f-${name}`;
  const isPassword = input.type === "password";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type: _type, ...rest } = input;
  const common = {
    id,
    name,
    "aria-invalid": !!error,
    "aria-describedby": error ? `${id}-err` : hint ? `${id}-hint` : undefined,
    className: inputClass(!!error, BASE),
  } as const;
  return (
    <div data-field={name}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      {isPassword ? (
        <PasswordInput {...common} {...rest} />
      ) : (
        <input {...common} {...input} />
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-err`} message={error} />
    </div>
  );
}

/** Labelled dropdown (City, Province, Vehicle…). */
export function SelectField({
  name,
  label,
  required,
  hint,
  error,
  options,
  placeholder,
  ...select
}: Common & {
  options: readonly string[];
  placeholder?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name">) {
  const id = `f-${name}`;
  const value = typeof select.value === "string" ? select.value : "";
  const extra = value && !options.includes(value) ? [value] : [];
  return (
    <div data-field={name}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <select
        id={id}
        name={name}
        aria-invalid={!!error}
        className={inputClass(!!error, BASE)}
        {...select}
      >
        <option value="">{placeholder || "Choose…"}</option>
        {extra.map((o) => (
          <option key={`legacy-${o}`} value={o}>
            {o} (please choose from the list)
          </option>
        ))}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      <FieldError id={`${id}-err`} message={error} />
    </div>
  );
}

/** Scroll to and focus the first field that has an error. */
export function scrollToFirstError(errors: Record<string, string> | null | undefined, order?: string[]) {
  if (!errors || typeof document === "undefined") return;
  const keys = Object.keys(errors);
  if (!keys.length) return;
  const nodes = keys
    .map((k) => document.querySelector<HTMLElement>(`[data-field="${CSS.escape(k)}"]`))
    .filter((n): n is HTMLElement => !!n);
  if (!nodes.length) return;
  let first = nodes[0];
  if (order) {
    const sorted = keys
      .filter((k) => order.includes(k))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const n = sorted.length
      ? document.querySelector<HTMLElement>(`[data-field="${CSS.escape(sorted[0])}"]`)
      : null;
    if (n) first = n;
  } else {
    // Topmost in the page
    first = nodes.reduce((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a
    );
  }
  window.setTimeout(() => {
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    first.querySelector<HTMLElement>("input,select,textarea,button")?.focus({ preventScroll: true });
  }, 0);
}
