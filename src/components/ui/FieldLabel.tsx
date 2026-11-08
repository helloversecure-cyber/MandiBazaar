import type { ReactNode } from "react";

/** Red asterisk for required form fields */
export function RequiredMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`ml-0.5 font-semibold text-red-600 ${className}`}
      aria-hidden
    >
      *
    </span>
  );
}

/** Label text with optional red * */
export function FieldLabel({
  children,
  required,
  htmlFor,
  className = "mb-1 block text-sm font-medium text-slate-700",
}: {
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={className}>
      {children}
      {required ? <RequiredMark /> : null}
    </label>
  );
}
