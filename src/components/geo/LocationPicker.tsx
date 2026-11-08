"use client";

import { useState } from "react";
import { Crosshair, MapPin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { FieldLabel } from "@/components/ui/FieldLabel";

/**
 * "Use my current location" + optional manual latitude/longitude (QA L3, M2, N7).
 * Typed values are validated by the form schema — nothing is silently ignored.
 */
export function LocationPicker({
  latitude,
  longitude,
  onChange,
  latitudeError,
  longitudeError,
  label = "Location",
  required,
  help,
}: {
  latitude: string;
  longitude: string;
  onChange: (next: { latitude: string; longitude: string }) => void;
  latitudeError?: string;
  longitudeError?: string;
  label?: string;
  required?: boolean;
  help?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [manual, setManual] = useState(false);
  const hasPin = latitude.trim() !== "" && longitude.trim() !== "";
  const showManual = manual || !!latitudeError || !!longitudeError;

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus({ tone: "err", text: "This device can't share its location. Enter it manually below." });
      setManual(true);
      return;
    }
    setBusy(true);
    setStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
        setStatus({ tone: "ok", text: "Location captured" });
      },
      (err) => {
        setBusy(false);
        setStatus({
          tone: "err",
          text:
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied. Allow location access, or enter it manually below."
              : "Couldn't get your location. Try again outdoors, or enter it manually below.",
        });
        setManual(true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  const base = "w-full rounded-xl border bg-slate-50 px-4 py-3 text-sm outline-none focus:bg-white focus:ring-2";

  return (
    <div className="space-y-2" data-field="latitude">
      <FieldLabel required={required}>{label}</FieldLabel>
      {help && <p className="text-xs text-slate-500">{help}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={locate} disabled={busy}>
          <Crosshair className="mr-1.5 h-4 w-4" />
          {busy ? "Getting location…" : "Use my current location"}
        </Button>
        {hasPin && !latitudeError && !longitudeError && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <MapPin className="h-3.5 w-3.5" />
            {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}
            <a
              href={`https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline"
            >
              Check on map
            </a>
          </span>
        )}
        {hasPin && (
          <button
            type="button"
            className="text-xs text-slate-500 underline"
            onClick={() => {
              onChange({ latitude: "", longitude: "" });
              setStatus(null);
            }}
          >
            Remove
          </button>
        )}
        {!showManual && (
          <button type="button" className="text-xs text-brand-600 underline" onClick={() => setManual(true)}>
            Enter manually
          </button>
        )}
      </div>
      {status && (
        <p className={`text-xs ${status.tone === "ok" ? "text-emerald-700" : "text-amber-700"}`}>{status.text}</p>
      )}
      {showManual && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div data-field="latitude-input">
            <input
              aria-label="Latitude"
              inputMode="decimal"
              className={inputClass(!!latitudeError, base)}
              placeholder="Latitude, e.g. 31.5204"
              value={latitude}
              onChange={(e) => onChange({ latitude: e.target.value, longitude })}
            />
          </div>
          <div data-field="longitude">
            <input
              aria-label="Longitude"
              inputMode="decimal"
              className={inputClass(!!longitudeError, base)}
              placeholder="Longitude, e.g. 74.3587"
              value={longitude}
              onChange={(e) => onChange({ latitude, longitude: e.target.value })}
            />
          </div>
        </div>
      )}
      <FieldError message={latitudeError} />
      {longitudeError !== latitudeError && <FieldError message={longitudeError} />}
    </div>
  );
}
