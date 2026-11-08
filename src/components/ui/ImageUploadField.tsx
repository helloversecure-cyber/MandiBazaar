"use client";

import { useRef, useState } from "react";
import { RequiredMark } from "@/components/ui/FieldLabel";

type Props = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  folder?: string;
  /** profile ≤1MB; business ≤~2MB after server optimize */
  kind?: "profile" | "business";
  hint?: string;
  /** Prefer camera: "user" = front, "environment" = rear (mobile) */
  capture?: "user" | "environment";
};

export function ImageUploadField({
  label,
  value,
  onChange,
  required,
  folder = "stores",
  kind,
  hint,
  capture,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("folder", folder);
      if (kind) body.append("kind", kind);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Upload failed");
        return;
      }
      onChange(data.data.url);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="text-sm">
      <p className="font-medium text-slate-700">
        {label}
        {required ? <RequiredMark /> : null}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-dashed border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50"
        >
          {uploading
            ? "Uploading…"
            : value
              ? capture
                ? "Retake photo"
                : "Change image"
              : capture
                ? "Open camera"
                : "Choose image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={
            capture
              ? "image/*"
              : "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp"
          }
          {...(capture ? { capture } : {})}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {value && (
          <button
            type="button"
            className="text-xs text-red-600 underline"
            onClick={() => onChange("")}
          >
            Remove
          </button>
        )}
      </div>

      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={label}
          className="mt-3 h-28 w-auto max-w-full rounded-xl border border-surface-border object-cover"
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {required && !value && (
        <input
          tabIndex={-1}
          className="sr-only"
          required
          value=""
          onChange={() => {}}
          aria-hidden
        />
      )}
    </div>
  );
}
