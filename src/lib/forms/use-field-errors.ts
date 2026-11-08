"use client";

import { useCallback, useState } from "react";
import type { z } from "zod";
import { validateFields, type FieldErrors } from "@/lib/validators/pk";

/**
 * Per-field error state for forms.
 *
 *   const fe = useFieldErrors();
 *   if (!fe.check(schema, values)) return;          // client pre-check, same rules as server
 *   const data = await res.json();
 *   if (!data.success) return fe.fromResponse(data); // shows server fieldErrors under fields
 *   <input ... aria-invalid={!!fe.get("phone")} /> <FieldError message={fe.get("phone")} />
 */
export function useFieldErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");

  const clear = useCallback((field?: string) => {
    if (!field) {
      setErrors({});
      setFormError("");
      return;
    }
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const check = useCallback(<T extends z.ZodTypeAny>(schema: T, values: unknown): boolean => {
    const fe = validateFields(schema, values);
    setErrors(fe || {});
    setFormError(fe ? "Please fix the highlighted fields" : "");
    return !fe;
  }, []);

  /** Apply an API error body. Returns false so callers can `return fe.fromResponse(data)`. */
  const fromResponse = useCallback(
    (data: { error?: string; fieldErrors?: FieldErrors } | null | undefined): false => {
      const fe = data?.fieldErrors || {};
      setErrors(fe);
      const keys = Object.keys(fe);
      // One clear field problem → show its message as the banner too (e.g. a
      // duplicate "This phone number is already registered…"), not a generic line.
      setFormError(
        keys.length === 1
          ? fe[keys[0]]
          : keys.length
            ? "Please fix the highlighted fields"
            : data?.error || "Something went wrong. Please try again."
      );
      return false;
    },
    []
  );

  return {
    errors,
    formError,
    setFormError,
    setErrors,
    get: (field: string) => errors[field],
    has: (field: string) => Boolean(errors[field]),
    clear,
    check,
    fromResponse,
  };
}
