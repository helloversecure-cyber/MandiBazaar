/** Red message shown directly under a form field. Renders nothing when empty. */
export function FieldError({ message, id }: { message?: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600">
      {message}
    </p>
  );
}

/** Banner for errors that are not tied to one field. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
      {message}
    </p>
  );
}

/** Tailwind classes for an input, red when invalid. */
export function inputClass(invalid?: boolean, base = "w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2") {
  return `${base} ${invalid ? "border-red-400 focus:ring-red-200" : "border-slate-200 focus:border-brand-500 focus:ring-brand-100"}`;
}
