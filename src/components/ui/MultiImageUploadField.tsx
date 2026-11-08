"use client";

import { useRef, useState } from "react";
import { X, Plus, Star } from "lucide-react";
import { RequiredMark } from "@/components/ui/FieldLabel";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 5;

type Props = {
  label: string;
  values: string[];
  onChange: (urls: string[]) => void;
  required?: boolean;
  folder?: string;
  kind?: "profile" | "business";
  hint?: string;
  max?: number;
};

export function MultiImageUploadField({
  label,
  values,
  onChange,
  required,
  folder = "products",
  kind = "business",
  hint,
  max = MAX_IMAGES,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function onFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError("");
    const remaining = max - values.length;
    if (remaining <= 0) {
      setError(`Maximum ${max} images allowed`);
      return;
    }

    const files = Array.from(fileList).slice(0, remaining);
    setUploading(true);
    const next = [...values];

    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        body.append("folder", folder);
        body.append("kind", kind);
        const res = await fetch("/api/upload", { method: "POST", body });
        const data = await res.json();
        if (!data.success) {
          setError(data.error || "Upload failed");
          break;
        }
        next.push(data.data.url);
      }
      onChange(next);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function makePrimary(index: number) {
    if (index === 0) return;
    const next = [...values];
    const [picked] = next.splice(index, 1);
    next.unshift(picked);
    onChange(next);
  }

  return (
    <div className="text-sm">
      <p className="font-medium text-slate-700">
        {label}
        {required ? <RequiredMark /> : null}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        {hint ||
          `Upload up to ${max} clear product photos. First image is the main photo.`}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {values.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="group relative aspect-square overflow-hidden rounded-xl border border-surface-border bg-slate-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Product ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute left-1.5 top-1.5 rounded-md bg-brand-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                Main
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              {i !== 0 && (
                <button
                  type="button"
                  onClick={() => makePrimary(i)}
                  className="flex flex-1 items-center justify-center gap-0.5 rounded-md bg-white/95 px-1 py-1 text-[10px] font-semibold text-slate-800"
                >
                  <Star className="h-3 w-3" /> Main
                </button>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="rounded-md bg-white/95 p-1 text-red-600"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {values.length < max && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-brand-200 bg-brand-50 text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
            )}
          >
            <Plus className="h-6 w-6" />
            <span className="text-xs font-semibold">
              {uploading ? "Uploading…" : "Add photo"}
            </span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {required && values.length === 0 && (
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
