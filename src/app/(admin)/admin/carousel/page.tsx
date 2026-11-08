"use client";

import { useEffect, useState } from "react";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { Images } from "lucide-react";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { zSafeLink } from "@/lib/validators/pk";

type SlideForm = {
  imageUrl: string;
  tag: string;
  title: string;
  sub: string;
  cta: string;
  href: string;
  stat: string;
  isActive: boolean;
};

const EMPTY: SlideForm = {
  imageUrl: "",
  tag: "",
  title: "",
  sub: "",
  cta: "Shop now",
  href: "/products",
  stat: "",
  isActive: true,
};

function blankSlides(): SlideForm[] {
  return [
    { ...EMPTY, tag: "SLIDE 1", title: "" },
    { ...EMPTY, tag: "SLIDE 2", title: "" },
    { ...EMPTY, tag: "SLIDE 3", title: "" },
  ];
}

export default function AdminCarouselPage() {
  const [slides, setSlides] = useState<SlideForm[]>(blankSlides());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    fetch("/api/admin/carousel")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data?.items) && d.data.items.length) {
          const mapped = d.data.items.slice(0, 3).map((s: SlideForm) => ({
            imageUrl: s.imageUrl || "",
            tag: s.tag || "",
            title: s.title || "",
            sub: s.sub || "",
            cta: s.cta || "Shop now",
            href: s.href || "/products",
            stat: s.stat || "",
            isActive: s.isActive !== false,
          }));
          while (mapped.length < 3) mapped.push({ ...EMPTY });
          setSlides(mapped);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  function update(i: number, patch: Partial<SlideForm>) {
    setSlides((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    if (patch.href !== undefined) {
      setLinkErrors((prev) => {
        const next = { ...prev };
        delete next[i];
        return next;
      });
    }
  }

  /** Client-side zSafeLink check (server checks again): /page or https:// only. */
  function checkLinks(): boolean {
    const errs: Record<number, string> = {};
    slides.forEach((s, i) => {
      const filled = s.imageUrl.trim() && s.title.trim();
      if (!filled || !s.href.trim()) return;
      const r = zSafeLink.safeParse(s.href);
      if (!r.success) errs[i] = r.error.issues[0]?.message || "Invalid link";
    });
    setLinkErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const active = slides.filter((s) => s.imageUrl.trim() && s.title.trim());
    if (!active.length) {
      setMsg("Add at least one slide with image + title (or use Clear all).");
      return;
    }
    if (!checkLinks()) {
      setMsg("Fix the highlighted button link(s).");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/carousel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slides: active.map((s, i) => ({
            ...s,
            sortOrder: i,
          })),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMsg(data.error || "Save failed");
        return;
      }
      setMsg("");
      toast.success(`Saved ${data.data.items.length} slide(s) — live on the homepage`);
    } catch {
      setMsg("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    const r = await confirm({
      title: "Remove all homepage carousel slides?",
      message: "The homepage will hide the banner until you upload new slides.",
      confirmLabel: "Remove all",
      tone: "danger",
    });
    if (!r.confirmed) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/carousel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides: [] }),
      });
      const data = await res.json();
      if (!data.success) {
        setMsg(data.error || "Failed");
        return;
      }
      setSlides(blankSlides());
      setLinkErrors({});
      toast.success("Carousel cleared — the homepage hides the banner until you upload again");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink-subtle">Loading carousel…</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl">
            <Images className="h-7 w-7" />
            Homepage carousel
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-subtle">
            Upload up to 3 banner images. They appear on the public homepage.
            Images are optimized on upload (about 1–2MB).
          </p>
        </div>
        <button
          type="button"
          onClick={clearAll}
          disabled={saving}
          className="rounded-full border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Clear all
        </button>
      </div>

      <form onSubmit={save} className="mt-6 space-y-6">
        {slides.map((slide, i) => (
          <div
            key={i}
            className="rounded-3xl border border-line bg-card p-5 shadow-card sm:p-6"
          >
            <p className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-muted">
              Slide {i + 1}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <ImageUploadField
                label="Banner image"
                value={slide.imageUrl}
                onChange={(url) => update(i, { imageUrl: url })}
                folder="carousel"
                hint="Wide image works best (about 1600×600)"
              />
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-ink-subtle">Or paste image URL</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    placeholder="https://…"
                    value={slide.imageUrl.startsWith("data:") ? "" : slide.imageUrl}
                    onChange={(e) => update(i, { imageUrl: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-ink-subtle">Tag</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    value={slide.tag}
                    onChange={(e) => update(i, { tag: e.target.value })}
                    placeholder="MEGA SALE"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-ink-subtle">Title</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    value={slide.title}
                    onChange={(e) => update(i, { title: e.target.value })}
                    placeholder="Up to 40% Off"
                  />
                </label>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-subtle">Subtitle</span>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={slide.sub}
                  onChange={(e) => update(i, { sub: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-subtle">Button text</span>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={slide.cta}
                  onChange={(e) => update(i, { cta: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-subtle">Button link</span>
                <input
                  className={inputClass(Boolean(linkErrors[i]), "mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2")}
                  value={slide.href}
                  aria-invalid={Boolean(linkErrors[i])}
                  onChange={(e) => update(i, { href: e.target.value })}
                  onBlur={() => {
                    const v = slide.href.trim();
                    if (!v) return;
                    const r = zSafeLink.safeParse(v);
                    if (!r.success) {
                      setLinkErrors((prev) => ({ ...prev, [i]: r.error.issues[0]?.message || "Invalid link" }));
                    }
                  }}
                  placeholder="/products"
                />
                <FieldError message={linkErrors[i]} />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-subtle">Small badge / stat</span>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={slide.stat}
                  onChange={(e) => update(i, { stat: e.target.value })}
                  placeholder="Free delivery Rs. 5,000+"
                />
              </label>
            </div>
          </div>
        ))}

        {msg && (
          <p className="text-sm text-red-600" role="alert">
            {msg}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-brand-600 px-6 py-2.5 text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save carousel"}
        </button>
      </form>
    </div>
  );
}
