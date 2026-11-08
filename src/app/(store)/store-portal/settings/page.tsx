"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { FieldError, FormError, inputClass as fieldInputClass } from "@/components/ui/FieldError";
import { SelectField, TextField, scrollToFirstError } from "@/components/auth/FormField";
import { LocationPicker } from "@/components/geo/LocationPicker";
import { useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { PK_CITIES, PK_PROVINCES } from "@/lib/validators/pk";
import { validateStoreProfile } from "@/lib/validators/signup-forms";

type Store = {
  id: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  area: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  bankAccountTitle: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIban: string | null;
  jazzCashNumber: string | null;
  jazzCashAccountTitle: string | null;
  googleMapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
};

type FormState = {
  name: string;
  logoUrl: string;
  coverUrl: string;
  description: string;
  phone: string;
  email: string;
  addressLine: string;
  area: string;
  city: string;
  province: string;
  postalCode: string;
  bankAccountTitle: string;
  bankName: string;
  bankAccountNumber: string;
  bankIban: string;
  jazzCashNumber: string;
  jazzCashAccountTitle: string;
  googleMapsUrl: string;
  latitude: string;
  longitude: string;
};

function emptyForm(): FormState {
  return {
    name: "",
    logoUrl: "",
    coverUrl: "",
    description: "",
    phone: "",
    email: "",
    addressLine: "",
    area: "",
    city: "",
    province: "",
    postalCode: "",
    bankAccountTitle: "",
    bankName: "",
    bankAccountNumber: "",
    bankIban: "",
    jazzCashNumber: "",
    jazzCashAccountTitle: "",
    googleMapsUrl: "",
    latitude: "",
    longitude: "",
  };
}

function storeToForm(s: Store): FormState {
  return {
    name: s.name || "",
    logoUrl: s.logoUrl || "",
    coverUrl: s.coverUrl || "",
    description: s.description || "",
    phone: s.phone || "",
    email: s.email || "",
    addressLine: s.addressLine || "",
    area: s.area || "",
    city: s.city || "",
    province: s.province || "",
    postalCode: s.postalCode || "",
    bankAccountTitle: s.bankAccountTitle || "",
    bankName: s.bankName || "",
    bankAccountNumber: s.bankAccountNumber || "",
    bankIban: s.bankIban || "",
    jazzCashNumber: s.jazzCashNumber || "",
    jazzCashAccountTitle: s.jazzCashAccountTitle || "",
    googleMapsUrl: s.googleMapsUrl || "",
    latitude: s.latitude != null ? String(s.latitude) : "",
    longitude: s.longitude != null ? String(s.longitude) : "",
  };
}

export default function StoreSettingsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const fe = useFieldErrors();
  const toast = useToast();
  const [pageLoading, setPageLoading] = useState(true);

  const load = useCallback(async (preferredId?: string) => {
    setPageLoading(true);
    try {
      const res = await fetch("/api/store?resource=stores");
      const d = await res.json();
      if (!d.success) {
        setMsg(d.error || "Could not load stores");
        return;
      }
      const items: Store[] = d.data.items || [];
      setStores(items);
      const nextId =
        preferredId && items.some((s) => s.id === preferredId)
          ? preferredId
          : items[0]?.id || "";
      setStoreId(nextId);
      const selected = items.find((s) => s.id === nextId);
      setForm(selected ? storeToForm(selected) : emptyForm());
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectStore(id: string) {
    setStoreId(id);
    setMsg("");
    fe.clear();
    const s = stores.find((x) => x.id === id);
    if (s) setForm(storeToForm(s));
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    fe.clear(key);
    if (key === "bankIban" || key === "jazzCashNumber" || key === "bankAccountNumber") {
      fe.clear("bankAccountNumber");
    }
    if (key === "googleMapsUrl") fe.clear("latitude");
  }

  /** Same rules as the server (store signup rules + payout + location). */
  function validateClient(): Record<string, string> | null {
    // Logo/cover are checked by the server only when changed (older seed URLs stay valid)
    const v = validateStoreProfile({ ...form, logoUrl: undefined }, { server: false });
    return v.success ? null : v.errors;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!storeId) {
      setMsg("Select a store first");
      return;
    }
    const selected = stores.find((s) => s.id === storeId);
    if (selected && selected.status !== "APPROVED") {
      setMsg("Only approved stores can update profile");
      return;
    }
    const errs = validateClient();
    if (errs) {
      fe.setErrors(errs);
      fe.setFormError("Please fix the highlighted fields before saving");
      scrollToFirstError(errs);
      return;
    }
    fe.clear();

    setLoading(true);
    try {
      const res = await fetch("/api/store", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_PROFILE",
          storeId,
          name: form.name.trim(),
          logoUrl: form.logoUrl || null,
          coverUrl: form.coverUrl || null,
          description: form.description.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          addressLine: form.addressLine.trim(),
          area: form.area.trim() || null,
          city: form.city.trim(),
          province: form.province.trim(),
          postalCode: form.postalCode.trim() || null,
          bankAccountTitle: form.bankAccountTitle.trim() || null,
          bankName: form.bankName.trim() || null,
          bankAccountNumber: form.bankAccountNumber.trim() || null,
          bankIban: form.bankIban.trim() || null,
          jazzCashNumber: form.jazzCashNumber.trim() || null,
          jazzCashAccountTitle: form.jazzCashAccountTitle.trim() || null,
          googleMapsUrl: form.googleMapsUrl.trim() || null,
          latitude: form.latitude.trim() || null,
          longitude: form.longitude.trim() || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        if (data.fieldErrors) scrollToFirstError(data.fieldErrors);
        return;
      }
      setMsg("");
      toast.success("Store profile saved");
      await load(storeId);
    } catch {
      fe.setFormError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:bg-card";

  const selected = stores.find((s) => s.id === storeId);
  const savedHasPayout = Boolean(
    selected && (selected.bankAccountNumber || selected.bankIban || selected.jazzCashNumber)
  );
  const savedHasLocation = Boolean(selected && selected.latitude != null && selected.longitude != null);

  function text(
    key: keyof FormState,
    label: string,
    opts: {
      required?: boolean;
      placeholder?: string;
      hint?: string;
      maxLength: number;
      type?: string;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    }
  ) {
    return (
      <TextField
        name={key}
        label={label}
        required={opts.required}
        placeholder={opts.placeholder}
        hint={opts.hint}
        maxLength={opts.maxLength}
        type={opts.type || "text"}
        inputMode={opts.inputMode}
        value={form[key]}
        onChange={(e) => setField(key, e.target.value)}
        error={fe.get(key)}
      />
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-ink">Store profile</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Update store name, photos, address, and payout details. Customers see logo / cover on your store page.
      </p>

      {pageLoading ? (
        <p className="mt-6 text-sm text-ink-subtle">Loading store…</p>
      ) : stores.length === 0 ? (
        <p className="mt-6 text-sm text-deal-600">{msg || "No store found for this account."}</p>
      ) : (
        <>
          <div className="mt-4 max-w-xl">
            <FieldLabel>Store</FieldLabel>
            <select className={inputClass} value={storeId} onChange={(e) => selectStore(e.target.value)}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          </div>

          {selected && (!savedHasPayout || !savedHasLocation) && (
            <div
              role="status"
              className="mt-4 max-w-2xl space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Your store profile is incomplete
              </p>
              {!savedHasPayout && (
                <p>
                  Your store can&apos;t receive payouts until you add a bank account number, IBAN or JazzCash number.
                </p>
              )}
              {!savedHasLocation && (
                <p>
                  Delivery fees are flat (not by distance) until you add your store location — tap “Use my current
                  location” at your shop, or paste a Google Maps link.
                </p>
              )}
            </div>
          )}

          <form
            onSubmit={save}
            noValidate
            className="mt-6 max-w-2xl space-y-4 rounded-2xl border border-line bg-card p-5 shadow-card"
          >
            <h2 className="text-lg font-bold text-ink">Basics</h2>

            {text("name", "Store name", { required: true, maxLength: 80, placeholder: "e.g. Ali Fresh Mart" })}

            <div data-field="logoUrl">
              <ImageUploadField
                label="Store logo / DP"
                folder="logos"
                kind="profile"
                value={form.logoUrl}
                onChange={(url) => setField("logoUrl", url)}
              />
              <FieldError message={fe.get("logoUrl")} />
            </div>

            <div data-field="coverUrl">
              <ImageUploadField
                label="Store cover image"
                folder="shops"
                kind="business"
                value={form.coverUrl}
                onChange={(url) => setField("coverUrl", url)}
              />
              <FieldError message={fe.get("coverUrl")} />
            </div>

            <div data-field="description">
              <FieldLabel htmlFor="f-description">Description</FieldLabel>
              <textarea
                id="f-description"
                className={`${fieldInputClass(
                  !!fe.get("description"),
                  "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2"
                )} min-h-[100px]`}
                value={form.description}
                maxLength={1000}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="What you sell, areas you serve…"
              />
              <p className="mt-1 text-right text-[11px] text-ink-subtle">{form.description.length}/1000</p>
              <FieldError message={fe.get("description")} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {text("phone", "Phone", {
                maxLength: 16,
                type: "tel",
                inputMode: "tel",
                placeholder: "042-35761234",
                hint: "Landline, UAN or mobile",
              })}
              {text("email", "Email", { maxLength: 100, type: "email", placeholder: "e.g. shop@gmail.com" })}
            </div>

            <h2 className="pt-2 text-lg font-bold text-ink">Address</h2>
            {selected?.status === "APPROVED" && (
              <p className="text-xs text-ink-subtle">
                Changes to your store name or address are shared with MandiBazaar.
              </p>
            )}

            {text("addressLine", "Shop / warehouse address", {
              required: true,
              maxLength: 120,
              placeholder: "e.g. Shop 4, Main Boulevard",
            })}

            <div className="grid gap-4 sm:grid-cols-2">
              {text("area", "Area", { maxLength: 120, placeholder: "e.g. Gulberg III" })}
              {text("postalCode", "Postal code", { maxLength: 5, inputMode: "numeric", placeholder: "54000" })}
              <SelectField
                name="city"
                label="City"
                required
                options={PK_CITIES}
                placeholder="Choose a city"
                value={form.city}
                onChange={(e) => setField("city", e.target.value)}
                error={fe.get("city")}
              />
              <SelectField
                name="province"
                label="Province"
                required
                options={PK_PROVINCES}
                placeholder="Choose a province"
                value={form.province}
                onChange={(e) => setField("province", e.target.value)}
                error={fe.get("province")}
              />
            </div>

            <h2 className="pt-2 text-lg font-bold text-ink">Payout</h2>
            <p className="text-xs text-ink-subtle">
              Required: at least one of account number, IBAN or JazzCash number.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {text("bankAccountTitle", "Bank account title", { maxLength: 80, placeholder: "Name on the account" })}
              {text("bankName", "Bank name", { maxLength: 80, placeholder: "e.g. Meezan Bank" })}
              {text("bankAccountNumber", "Account number", {
                maxLength: 24,
                inputMode: "numeric",
                placeholder: "0012345678901",
                hint: "10–20 digits",
              })}
              {text("bankIban", "IBAN", {
                maxLength: 34,
                placeholder: "PK36SCBL0000001123456702",
                hint: "24 characters starting with PK",
              })}
              {text("jazzCashNumber", "JazzCash number", {
                maxLength: 16,
                type: "tel",
                inputMode: "tel",
                placeholder: "03001234567",
              })}
              {text("jazzCashAccountTitle", "JazzCash account title", {
                maxLength: 80,
                placeholder: "Name on the JazzCash account",
              })}
            </div>

            <h2 className="pt-2 text-lg font-bold text-ink">Store location</h2>

            <LocationPicker
              label="Map pin"
              required
              help="Used to charge delivery by distance. Tap the button while you are at your shop, or paste a Google Maps link below."
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={({ latitude, longitude }) => {
                setForm((f) => ({ ...f, latitude, longitude }));
                fe.clear("latitude");
                fe.clear("longitude");
              }}
              latitudeError={fe.get("latitude")}
              longitudeError={fe.get("longitude")}
            />

            {text("googleMapsUrl", "Google Maps link", {
              maxLength: 500,
              type: "url",
              placeholder: "https://maps.app.goo.gl/…",
              hint: "In Google Maps: find your shop → Share → Copy link. We read the location from it.",
            })}

            <FormError message={fe.formError} />
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Saving…" : "Save profile"}
              </Button>
              {msg && <span className="text-sm text-red-600">{msg}</span>}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
