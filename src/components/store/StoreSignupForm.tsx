"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { FieldLabel, RequiredMark } from "@/components/ui/FieldLabel";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { SelectField, TextField, scrollToFirstError } from "@/components/auth/FormField";
import { formatCnic, formatMobile } from "@/lib/forms/masks";
import { LocationPicker } from "@/components/geo/LocationPicker";
import {
  PK_CITIES,
  PK_PROVINCES,
  zCategoryName,
  zodFieldErrors,
  type FieldErrors,
} from "@/lib/validators/pk";
import {
  CATEGORY_REQUIRED_MSG,
  STORE_DOC_FIELDS,
  missingStoreDocErrors,
  requiredStoreDocs,
  storeOwnerSchema,
  storeSignupFieldError,
  validateStoreSignup,
  type StoreDocField,
} from "@/lib/validators/signup-forms";
import { VerifyEmailNotice } from "@/components/auth/VerifyEmailNotice";

type DocRow = { type: string; url: string; label?: string };
type PlatformCategory = { id: string; name: string };

/** Top-to-bottom order used to scroll to the first problem. */
const FIELD_ORDER = [
  "owner.fullName",
  "owner.phone",
  "owner.phoneCode",
  "owner.email",
  "owner.emailCode",
  "owner.password",
  "name",
  "logoUrl",
  "description",
  "phone",
  "email",
  "addressLine",
  "area",
  "city",
  "province",
  "postalCode",
  "latitude",
  "longitude",
  "googleMapsUrl",
  "cnicNumber",
  "requestedCategories",
  "otherCategoryName",
  ...STORE_DOC_FIELDS,
  "bankAccountTitle",
  "bankName",
  "bankAccountNumber",
  "bankIban",
  "jazzCashNumber",
  "jazzCashAccountTitle",
];

const textareaBase = "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2";

/** Shown as pickable suggestions when MandiBazaar has no active categories yet. */
const DEFAULT_CATEGORY_SUGGESTIONS = [
  "Vegetables",
  "Fruits",
  "Dairy & Eggs",
  "Meat & Poultry",
  "Rice & Grains",
  "Daal & Pulses",
  "Atta & Flour",
  "Spices & Masala",
  "Cooking Oil & Ghee",
  "Dry Fruits & Nuts",
  "Honey",
  "Bakery",
  "Beverages",
  "Snacks",
  "Household",
  "Personal Care",
];

export function StoreSignupForm({ onSwitchToLogin }: { onSwitchToLogin?: () => void }) {
  const { data: session, update: updateSession } = useSession();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isVirtual, setIsVirtual] = useState(false);
  const [platformCategories, setPlatformCategories] = useState<PlatformCategory[]>([]);
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>([]);
  const [useOtherCategory, setUseOtherCategory] = useState(false);
  // Custom categories as removable tags (type a name + Enter / comma → a chip).
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data)) {
          setPlatformCategories(d.data.map((c: PlatformCategory) => ({ id: c.id, name: c.name })));
        }
      })
      .catch(() => {
        /* ignore — form still allows Others */
      });
  }, []);

  function clearError(...keys: string[]) {
    setErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  function toggleCategory(name: string) {
    setSelectedCategoryNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
    clearError("requestedCategories");
  }

  /** Add a typed custom category as a tag (dedupes against picks + existing tags). */
  function addCustomCategory(raw: string) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length < 2) return;
    const taken = new Set(
      [...selectedCategoryNames, ...customCategories].map((n) => n.toLowerCase())
    );
    if (taken.has(name.toLowerCase())) {
      setCustomInput("");
      return;
    }
    setCustomCategories((prev) => (prev.length >= 20 ? prev : [...prev, name.slice(0, 40)]));
    setCustomInput("");
    clearError("otherCategoryName", "requestedCategories");
  }

  function removeCustomCategory(name: string) {
    setCustomCategories((prev) => prev.filter((n) => n !== name));
  }

  function buildRequestedCategories(): string[] {
    const names = [...selectedCategoryNames];
    if (useOtherCategory) {
      names.push(...customCategories);
      // Include a half-typed name the user didn't press Enter on, so it isn't lost.
      const pending = customInput.trim().replace(/\s+/g, " ");
      if (pending.length >= 2) names.push(pending);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
      if (out.length >= 20) break;
    }
    return out;
  }

  const [owner, setOwner] = useState({ fullName: "", phone: "", email: "", password: "" });
  const [done, setDone] = useState<{ email: string; devLink?: string } | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    phone: "",
    email: "",
    addressLine: "",
    area: "",
    city: "Lahore",
    province: "Punjab",
    postalCode: "",
    latitude: "",
    longitude: "",
    googleMapsUrl: "",
    cnicNumber: "",
    logoUrl: "",
    bankAccountTitle: "",
    bankName: "",
    bankAccountNumber: "",
    bankIban: "",
    jazzCashNumber: "",
    jazzCashAccountTitle: "",
  });
  type FormKey = keyof typeof form;

  const [docs, setDocs] = useState<Record<StoreDocField, string>>({
    cnicFront: "",
    cnicBack: "",
    shopImage: "",
    addressProof: "",
  });

  function setField(key: FormKey, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
    if (key === "bankAccountNumber" || key === "bankIban" || key === "jazzCashNumber") {
      clearError("bankAccountNumber");
    }
    if (key === "googleMapsUrl") clearError("latitude");
  }

  function setOwnerField(key: keyof typeof owner, value: string) {
    setOwner((o) => ({ ...o, [key]: value }));
    clearError(`owner.${key}`);
  }
  /** Live format check when a field loses focus (QA S0: errors while typing, not only on submit). */
  function checkFieldFormat(name: string, value: string) {
    const m = storeSignupFieldError(name, value);
    setErrors((prev) => {
      if (!m) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: m };
    });
  }

  function setDoc(key: StoreDocField, url: string) {
    setDocs((d) => ({ ...d, [key]: url }));
    clearError(key);
  }

  function showErrors(fe: FieldErrors) {
    setErrors(fe);
    const docKeys = STORE_DOC_FIELDS as readonly string[];
    const docCount = STORE_DOC_FIELDS.filter((k) => fe[k]).length;
    const otherKeys = Object.keys(fe).filter((k) => !docKeys.includes(k));

    // A single, clear field problem (e.g. "This phone number is already
    // registered…") is more helpful shown as-is than "fix 1 highlighted field".
    if (!docCount && otherKeys.length === 1) {
      setFormError(fe[otherKeys[0]]);
      scrollToFirstError(fe, FIELD_ORDER);
      return;
    }

    const parts: string[] = [];
    if (docCount) parts.push(`Please upload ${docCount} required document${docCount === 1 ? "" : "s"}`);
    if (otherKeys.length) {
      parts.push(
        docCount
          ? `fix ${otherKeys.length} highlighted field${otherKeys.length === 1 ? "" : "s"}`
          : `Please fix ${otherKeys.length} highlighted field${otherKeys.length === 1 ? "" : "s"}`
      );
    }
    setFormError(parts.join(" and ") || "Please check the form");
    scrollToFirstError(fe, FIELD_ORDER);
  }

  function clientErrors(requestedCategories: string[]): FieldErrors {
    const fe: FieldErrors = {};
    if (!session?.user) {
      const o = storeOwnerSchema.safeParse(owner);
      if (!o.success) {
        for (const [k, m] of Object.entries(zodFieldErrors(o.error))) fe[`owner.${k}`] = m;
      }
    }
    const v = validateStoreSignup({ ...form, isVirtual, requestedCategories }, { server: false });
    if (!v.success) Object.assign(fe, v.errors);
    // Added tags were validated at add-time; only re-check a half-typed pending name.
    if (useOtherCategory && customInput.trim()) {
      const c = zCategoryName.safeParse(customInput.trim().replace(/\s+/g, " "));
      if (!c.success) fe.otherCategoryName = c.error.issues[0]?.message || "Enter a valid category name";
    }
    Object.assign(fe, missingStoreDocErrors(docs, isVirtual));
    return fe;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setMsg("");

    const requestedCategories = buildRequestedCategories();
    const fe = clientErrors(requestedCategories);
    if (Object.keys(fe).length) {
      showErrors(fe);
      return;
    }
    setErrors({});

    const documents: DocRow[] = [
      { type: "CNIC_FRONT", url: docs.cnicFront },
      { type: "CNIC_BACK", url: docs.cnicBack },
      { type: isVirtual ? "WAREHOUSE_IMAGE" : "SHOP_IMAGE", url: docs.shopImage },
      ...(docs.addressProof ? [{ type: "ADDRESS_PROOF", url: docs.addressProof }] : []),
    ];

    const payload: Record<string, unknown> = {
      ...form,
      isVirtual,
      latitude: form.latitude.trim() || null,
      longitude: form.longitude.trim() || null,
      logoUrl: form.logoUrl || null,
      requestedCategories,
      documents,
    };
    if (!session?.user) payload.owner = owner;

    setLoading(true);
    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.fieldErrors && Object.keys(data.fieldErrors).length) {
          showErrors(data.fieldErrors);
        } else {
          setFormError(data.error || "Submission failed");
          topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      if (!session?.user) {
        setDone({ email: data.data?.ownerEmail || owner.email.trim(), devLink: data.data?.devLink });
        return;
      }
      setMsg(data.data.message || "Application submitted. MandiBazaar will review it.");
      {
        if (data.data?.roleUpgraded) {
          try {
            await updateSession();
          } catch {
            /* session refresh best-effort */
          }
        }
        setTimeout(() => {
          // Already signed in: the new/extra store stays PENDING until approved.
          // Send them to the portal, which shows their dashboard (approved) or the
          // Pending Approval screen (first store still under review).
          window.location.assign(
            "/store-portal?applied=1&msg=" +
              encodeURIComponent("New store submitted — MandiBazaar will review it.")
          );
        }, 1500);
      }
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function field(
    key: FormKey,
    label: string,
    opts?: {
      required?: boolean;
      type?: string;
      placeholder?: string;
      hint?: string;
      maxLength?: number;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    }
  ) {
    return (
      <TextField
        name={key}
        label={label}
        required={opts?.required}
        type={opts?.type || "text"}
        inputMode={opts?.inputMode}
        placeholder={opts?.placeholder}
        hint={opts?.hint}
        maxLength={opts?.maxLength}
        value={form[key]}
        onChange={(e) => {
          setField(key, e.target.value);
          if (errors[key]) checkFieldFormat(key, e.target.value);
        }}
        onBlur={(e) => checkFieldFormat(key, e.target.value)}
        error={errors[key]}
      />
    );
  }

  function ownerField(
    key: keyof typeof owner,
    label: string,
    opts: { required?: boolean; type?: string; placeholder?: string; hint?: string; maxLength: number; autoComplete?: string }
  ) {
    return (
      <TextField
        name={`owner.${key}`}
        label={label}
        required={opts.required}
        type={opts.type || "text"}
        placeholder={opts.placeholder}
        hint={opts.hint}
        maxLength={opts.maxLength}
        autoComplete={opts.autoComplete}
        value={owner[key]}
        onChange={(e) => {
          setOwnerField(key, e.target.value);
          if (errors[`owner.${key}`]) checkFieldFormat(`owner.${key}`, e.target.value);
        }}
        onBlur={(e) => checkFieldFormat(`owner.${key}`, e.target.value)}
        error={errors[`owner.${key}`]}
      />
    );
  }

  const neededDocs = requiredStoreDocs(isVirtual);
  const docUi: Record<StoreDocField, { label: string; folder: string; hint?: string }> = {
    cnicFront: { label: "CNIC front", folder: "cnic" },
    cnicBack: { label: "CNIC back", folder: "cnic" },
    shopImage: { label: isVirtual ? "Warehouse photo" : "Shop photo", folder: "shops" },
    addressProof: {
      label: isVirtual ? "Address proof (optional)" : "Address proof",
      folder: "proofs",
      hint: "Utility bill / rent agreement photo",
    },
  };

  if (done) {
    return <VerifyEmailNotice email={done.email} devLink={done.devLink} password={owner.password} />;
  }

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      <div ref={topRef}>
        {formError && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {formError}
          </p>
        )}
      </div>

      {!session?.user && (
        <section className="space-y-3 rounded-2xl border border-emerald-100 bg-card p-5 shadow-card">
          <h2 className="text-xl font-bold text-ink">Store owner account</h2>
          <p className="text-sm text-ink-subtle">
            Create your account, then submit the store application.
            {onSwitchToLogin && (
              <>
                {" "}
                Already registered?{" "}
                <button type="button" onClick={onSwitchToLogin} className="font-semibold text-brand-600 underline">
                  Sign in
                </button>
              </>
            )}
          </p>
          {ownerField("fullName", "Full name", { required: true, placeholder: "e.g. Muhammad Ali", maxLength: 60, autoComplete: "name" })}
          <TextField
            name="owner.phone"
            label="Mobile number"
            required
            type="tel"
            inputMode="tel"
            placeholder="03001234567"
            hint="03XXXXXXXXX, or +92 then 10 digits — used to sign in"
            maxLength={13}
            autoComplete="tel"
            value={owner.phone}
            onChange={(e) => {
              const v = formatMobile(e.target.value);
              setOwnerField("phone", v);
              if (errors["owner.phone"]) checkFieldFormat("owner.phone", v);
            }}
            onBlur={(e) => checkFieldFormat("owner.phone", e.target.value)}
            error={errors["owner.phone"]}
          />
          {errors["owner.phone"]?.includes("already registered") && onSwitchToLogin && (
            <p className="-mt-2 text-xs">
              <button type="button" onClick={onSwitchToLogin} className="font-semibold text-brand-600 underline">
                Sign in instead
              </button>
            </p>
          )}
          {ownerField("email", "Email", { required: true, type: "email", placeholder: "e.g. ali@gmail.com", maxLength: 100, autoComplete: "email" })}
          {ownerField("password", "Password", {
            required: true,
            type: "password",
            placeholder: "At least 8 characters",
            hint: "8–64 characters with a letter and a number",
            maxLength: 64,
            autoComplete: "new-password",
          })}
        </section>
      )}

      <section className="space-y-3 rounded-2xl bg-card p-5 shadow-card">
        <h2 className="font-display text-xl">Store details</h2>
        {field("name", "Store name", { required: true, placeholder: "e.g. Ali Fresh Mart", maxLength: 80 })}
        <div data-field="logoUrl">
          <ImageUploadField
            label="Store DP / logo"
            folder="logos"
            kind="profile"
            value={form.logoUrl}
            onChange={(url) => setField("logoUrl", url)}
            hint="Optimized to ≤1MB on upload"
          />
          <FieldError message={errors.logoUrl} />
        </div>
        <div data-field="description">
          <FieldLabel htmlFor="f-description">Description</FieldLabel>
          <textarea
            id="f-description"
            className={inputClass(!!errors.description, textareaBase)}
            rows={3}
            maxLength={1000}
            placeholder="What you sell, areas you serve…"
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
          />
          <p className="mt-1 text-right text-[11px] text-ink-subtle">{form.description.length}/1000</p>
          <FieldError message={errors.description} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isVirtual}
            onChange={(e) => {
              setIsVirtual(e.target.checked);
              clearError("addressProof");
            }}
          />
          Virtual store (warehouse / home kitchen — no physical shopfront)
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("phone", "Store phone (optional)", {
            type: "tel",
            inputMode: "tel",
            placeholder: "042-35761234",
            hint: "Landline, UAN (111-XXX-XXX) or mobile",
            maxLength: 16,
          })}
          {field("email", "Store email (optional)", { type: "email", placeholder: "e.g. shop@gmail.com", maxLength: 100 })}
        </div>
        {field("addressLine", isVirtual ? "Warehouse address" : "Shop address", {
          required: true,
          placeholder: "e.g. Shop 4, Main Boulevard",
          maxLength: 120,
        })}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("area", "Area (optional)", { placeholder: "e.g. Gulberg III", maxLength: 120 })}
          {field("postalCode", "Postal code (optional)", { inputMode: "numeric", placeholder: "54000", maxLength: 5 })}
          <SelectField
            name="city"
            label="City"
            required
            options={PK_CITIES}
            placeholder="Choose a city"
            value={form.city}
            onChange={(e) => setField("city", e.target.value)}
            error={errors.city}
          />
          <SelectField
            name="province"
            label="Province"
            required
            options={PK_PROVINCES}
            placeholder="Choose a province"
            value={form.province}
            onChange={(e) => setField("province", e.target.value)}
            error={errors.province}
          />
        </div>

        <div className="space-y-3 rounded-xl border border-line bg-app/60 p-4">
          <LocationPicker
            label="Store location"
            required
            help="Needed to calculate delivery fees by distance. Tap the button while you are at your shop, or paste a Google Maps link below."
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={({ latitude, longitude }) => {
              setForm((f) => ({ ...f, latitude, longitude }));
              clearError("latitude", "longitude");
            }}
            latitudeError={errors.latitude}
            longitudeError={errors.longitude}
          />
          {field("googleMapsUrl", "Google Maps link (optional if location is set)", {
            type: "url",
            placeholder: "https://maps.app.goo.gl/…",
            hint: "In Google Maps: find your shop → Share → Copy link",
            maxLength: 500,
          })}
        </div>

        <TextField
          name="cnicNumber"
          label="Owner CNIC number"
          required
          inputMode="numeric"
          placeholder="35202-1234567-1"
          hint="13 digits, e.g. 35202-1234567-1"
          maxLength={15}
          value={form.cnicNumber}
          onChange={(e) => {
            const v = formatCnic(e.target.value);
            setField("cnicNumber", v);
            if (errors.cnicNumber) checkFieldFormat("cnicNumber", v);
          }}
          onBlur={(e) => checkFieldFormat("cnicNumber", e.target.value)}
          error={errors.cnicNumber}
        />
      </section>

      <section className="space-y-3 rounded-2xl bg-card p-5 shadow-card" data-field="requestedCategories">
        <div>
          <h2 className="font-display text-xl">
            Categories you want to sell
            <RequiredMark />
          </h2>
          <p className="mt-1 text-xs text-ink-subtle">
            Pick from MandiBazaar categories. If yours is missing, choose Others and type the name — MandiBazaar will
            review when approving your store.
          </p>
        </div>

        {(() => {
          const usingSuggestions = platformCategories.length === 0;
          const options = usingSuggestions
            ? DEFAULT_CATEGORY_SUGGESTIONS.map((name, i) => ({ id: `suggest-${i}`, name }))
            : platformCategories;
          return (
            <>
              {usingSuggestions && (
                <p className="text-xs text-ink-subtle">
                  Suggested categories — pick any that fit. MandiBazaar confirms them when approving your store.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((c) => {
                  const checked = selectedCategoryNames.includes(c.name);
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                        checked ? "border-brand-300 bg-brand-50 text-brand-900" : "border-line bg-app text-ink"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(c.name)}
                        className="rounded border-slate-300"
                      />
                      <span className="font-medium">{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </>
          );
        })()}

        <label
          className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            useOtherCategory ? "border-brand-300 bg-brand-50 text-brand-900" : "border-line bg-app text-ink"
          }`}
        >
          <input
            type="checkbox"
            checked={useOtherCategory}
            onChange={(e) => {
              setUseOtherCategory(e.target.checked);
              if (!e.target.checked) {
                setCustomCategories([]);
                setCustomInput("");
              }
              clearError("requestedCategories", "otherCategoryName");
            }}
            className="rounded border-slate-300"
          />
          <span className="font-medium">Add your own category</span>
        </label>

        {useOtherCategory && (
          <div data-field="otherCategoryName">
            <FieldLabel htmlFor="f-custom-cat">Your categories</FieldLabel>
            {customCategories.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {customCategories.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => removeCustomCategory(name)}
                      className="ml-0.5 text-base leading-none text-brand-500 hover:text-brand-800"
                      aria-label={`Remove ${name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              id="f-custom-cat"
              type="text"
              placeholder="Type a category and press Enter (e.g. Dry Fruits)"
              maxLength={40}
              value={customInput}
              onChange={(e) => {
                setCustomInput(e.target.value);
                clearError("otherCategoryName", "requestedCategories");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addCustomCategory(customInput);
                }
              }}
              className={`w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2 ${
                errors.otherCategoryName ? "border-red-300" : "border-line"
              }`}
            />
            <p className="mt-1 text-xs text-ink-subtle">
              Press Enter (or comma) to add each one. MandiBazaar reviews custom categories on approval.
            </p>
            {errors.otherCategoryName && <FieldError message={errors.otherCategoryName} />}
          </div>
        )}

        {errors.requestedCategories ? (
          <FieldError message={errors.requestedCategories} />
        ) : (
          selectedCategoryNames.length === 0 &&
          !useOtherCategory && <p className="text-xs text-ink-subtle">{CATEGORY_REQUIRED_MSG}</p>
        )}
      </section>

      <section className="space-y-4 rounded-2xl bg-card p-5 shadow-card">
        <div>
          <h2 className="font-display text-xl">Documents</h2>
          <p className="mt-1 text-xs text-ink-subtle">
            Upload from gallery or camera. Large files are compressed on the server (about 1–2MB).
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {STORE_DOC_FIELDS.map((key) => (
            <div
              key={key}
              data-field={key}
              className={errors[key] ? "rounded-xl ring-2 ring-red-300 ring-offset-2" : undefined}
            >
              <ImageUploadField
                label={docUi[key].label}
                folder={docUi[key].folder}
                required={neededDocs.includes(key)}
                value={docs[key]}
                onChange={(url) => setDoc(key, url)}
                hint={docUi[key].hint}
              />
              <FieldError message={errors[key]} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-card p-5 shadow-card">
        <h2 className="font-display text-xl">Payout details</h2>
        <p className="text-xs text-ink-subtle">
          MandiBazaar pays you weekly (sales − platform commission) via bank or JazzCash. At least one of account
          number, IBAN or JazzCash number is required
          <RequiredMark />.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("bankAccountTitle", "Bank account title", { placeholder: "Name on the bank account", maxLength: 80 })}
          {field("bankName", "Bank name", { placeholder: "e.g. Meezan Bank", maxLength: 80 })}
          {field("bankAccountNumber", "Account number", {
            inputMode: "numeric",
            placeholder: "0012345678901",
            hint: "10–20 digits",
            maxLength: 24,
          })}
          {field("bankIban", "IBAN", {
            placeholder: "PK36SCBL0000001123456702",
            hint: "24 characters starting with PK",
            maxLength: 34,
          })}
          {field("jazzCashNumber", "JazzCash number", {
            type: "tel",
            inputMode: "tel",
            placeholder: "03001234567",
            maxLength: 16,
          })}
          {field("jazzCashAccountTitle", "JazzCash account title", { placeholder: "Name on the JazzCash account", maxLength: 80 })}
        </div>
      </section>

      {formError && <p className="text-sm font-medium text-red-600">{formError}</p>}
      {msg && <p className="text-sm text-leaf-700">{msg}</p>}

      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
        {loading ? "Submitting…" : "Submit for approval"}
      </Button>
    </form>
  );
}
