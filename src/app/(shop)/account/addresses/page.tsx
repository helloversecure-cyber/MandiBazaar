"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { SelectField, TextField, scrollToFirstError } from "@/components/auth/FormField";
import { LocationPicker } from "@/components/geo/LocationPicker";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { addressSchema } from "@/lib/validators/schemas";
import { PK_CITIES, PK_PROVINCES, validateFields } from "@/lib/validators/pk";

type Address = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  houseBuilding: string;
  street?: string | null;
  area: string;
  city: string;
  province: string;
  postalCode?: string | null;
  nearbyLandmark?: string | null;
  deliveryInstructions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
};

type FormState = {
  label: string;
  fullName: string;
  phone: string;
  houseBuilding: string;
  street: string;
  area: string;
  city: string;
  province: string;
  postalCode: string;
  nearbyLandmark: string;
  deliveryInstructions: string;
  latitude: string;
  longitude: string;
};

const emptyForm: FormState = {
  label: "Home",
  fullName: "",
  phone: "",
  houseBuilding: "",
  street: "",
  area: "",
  city: "Lahore",
  province: "Punjab",
  postalCode: "",
  nearbyLandmark: "",
  deliveryInstructions: "",
  latitude: "",
  longitude: "",
};

const LABELS = ["Home", "Work", "Other"];
const textareaBase = "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2";

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fe = useFieldErrors();
  const confirm = useConfirm();
  const toast = useToast();

  function load() {
    fetch("/api/addresses")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setAddresses(d.data);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    fe.clear(key);
  }

  function startEdit(a: Address) {
    setEditingId(a.id);
    setForm({
      label: a.label || "Home",
      fullName: a.fullName,
      phone: a.phone,
      houseBuilding: a.houseBuilding,
      street: a.street || "",
      area: a.area,
      city: a.city,
      province: a.province,
      postalCode: a.postalCode || "",
      nearbyLandmark: a.nearbyLandmark || "",
      deliveryInstructions: a.deliveryInstructions || "",
      latitude: a.latitude != null ? String(a.latitude) : "",
      longitude: a.longitude != null ? String(a.longitude) : "",
    });
    fe.clear();
    if (typeof window !== "undefined") {
      window.setTimeout(() => document.getElementById("address-form")?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    fe.clear();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Same rules as the server; invalid latitude/longitude text shows an error
    if (!fe.check(addressSchema, form)) {
      scrollToFirstError(validateFields(addressSchema, form));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/addresses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        scrollToFirstError(data.fieldErrors);
        return;
      }
      toast.success(editingId ? "Address updated" : "Address saved");
      setEditingId(null);
      setForm(emptyForm);
      fe.clear();
      load();
    } catch {
      fe.setFormError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/addresses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isDefault: true }),
      });
      const data = await res.json();
      if (!data.success) toast.error(data.error || "Could not update default address");
      else toast.success("Default address updated");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Address) {
    const { confirmed } = await confirm({
      title: "Delete this address?",
      message: `${a.label} — ${a.houseBuilding}, ${a.area}, ${a.city}`,
      confirmLabel: "Delete address",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/addresses?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Address deleted");
      if (editingId === a.id) cancelEdit();
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Saved addresses"
        subtitle="Manage delivery locations (optional pin for km-based fees)"
        badge="Addresses"
      />

      <div className="space-y-3">
        {addresses.map((a) => (
          <div key={a.id} className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <p className="font-semibold text-ink">
              {a.label} — {a.fullName}
              {a.isDefault && (
                <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                  Default
                </span>
              )}
            </p>
            <p className="text-sm text-ink-subtle">
              {[a.houseBuilding, a.street, a.area, a.city, a.province, a.postalCode].filter(Boolean).join(", ")}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">{a.phone}</p>
            {a.latitude != null && a.longitude != null && (
              <p className="mt-1 text-xs text-emerald-600">
                Pin: {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => startEdit(a)}>
                Edit
              </Button>
              {!a.isDefault && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => makeDefault(a.id)}>
                  Make default
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => remove(a)}
                className="text-deal-600"
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
        {!addresses.length && (
          <p className="rounded-2xl border border-dashed border-line py-8 text-center text-sm text-ink-subtle">
            No saved addresses yet. Your first address becomes your default.
          </p>
        )}
      </div>

      <form
        id="address-form"
        onSubmit={save}
        noValidate
        className="mt-8 space-y-4 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6"
      >
        <h2 className="font-bold text-ink">{editingId ? "Edit address" : "Add new address"}</h2>

        <div data-field="label">
          <FieldLabel>Save as</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {LABELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => set("label", l)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  form.label === l
                    ? "border-brand-400 bg-brand-50 text-brand-800"
                    : "border-line bg-card text-ink-muted"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <FieldError message={fe.get("label")} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="fullName"
            label="Full name"
            required
            placeholder="e.g. Ali Khan"
            autoComplete="name"
            maxLength={60}
            value={form.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            error={fe.get("fullName")}
          />
          <TextField
            name="phone"
            label="Phone"
            required
            type="tel"
            inputMode="tel"
            placeholder="03001234567"
            autoComplete="tel"
            maxLength={16}
            hint="e.g. 03001234567"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            error={fe.get("phone")}
          />
        </div>
        <TextField
          name="houseBuilding"
          label="House / Building"
          required
          placeholder="e.g. House 12, Block C"
          autoComplete="address-line1"
          maxLength={120}
          value={form.houseBuilding}
          onChange={(e) => set("houseBuilding", e.target.value)}
          error={fe.get("houseBuilding")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="street"
            label="Street (optional)"
            placeholder="e.g. Street 4"
            autoComplete="address-line2"
            maxLength={120}
            value={form.street}
            onChange={(e) => set("street", e.target.value)}
            error={fe.get("street")}
          />
          <TextField
            name="area"
            label="Area"
            required
            placeholder="e.g. Gulberg III"
            maxLength={120}
            value={form.area}
            onChange={(e) => set("area", e.target.value)}
            error={fe.get("area")}
          />
          <SelectField
            name="city"
            label="City"
            required
            options={PK_CITIES}
            placeholder="Choose a city"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            error={fe.get("city")}
          />
          <SelectField
            name="province"
            label="Province"
            required
            options={PK_PROVINCES}
            placeholder="Choose a province"
            value={form.province}
            onChange={(e) => set("province", e.target.value)}
            error={fe.get("province")}
          />
          <TextField
            name="postalCode"
            label="Postal code (optional)"
            inputMode="numeric"
            placeholder="e.g. 54000"
            autoComplete="postal-code"
            maxLength={5}
            value={form.postalCode}
            onChange={(e) => set("postalCode", e.target.value)}
            error={fe.get("postalCode")}
          />
          <TextField
            name="nearbyLandmark"
            label="Nearby landmark (optional)"
            placeholder="e.g. Near Liberty Market"
            maxLength={120}
            value={form.nearbyLandmark}
            onChange={(e) => set("nearbyLandmark", e.target.value)}
            error={fe.get("nearbyLandmark")}
          />
        </div>
        <div data-field="deliveryInstructions">
          <FieldLabel htmlFor="f-deliveryInstructions">Delivery instructions (optional)</FieldLabel>
          <textarea
            id="f-deliveryInstructions"
            className={inputClass(!!fe.get("deliveryInstructions"), textareaBase)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Call when you reach the gate"
            value={form.deliveryInstructions}
            onChange={(e) => set("deliveryInstructions", e.target.value)}
          />
          <FieldError message={fe.get("deliveryInstructions")} />
        </div>

        <LocationPicker
          label="Delivery pin (optional)"
          help="Sharing your location lets us charge delivery by distance."
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

        <FormError message={fe.formError} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : editingId ? "Update address" : "Save address"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
