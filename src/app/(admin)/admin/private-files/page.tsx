"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/feedback";

type Report = {
  configured: boolean;
  pending: Record<string, number>;
  pendingTotal: number;
  publicCopiesLeft: number;
};

const LABELS: Record<string, string> = {
  "rider.photoUrl": "Rider profile photos",
  "rider.cnicUrl": "Rider CNIC (front)",
  "rider.cnicBackUrl": "Rider CNIC (back)",
  "rider.licenseUrl": "Rider driving licences",
  "rider.bikeUrl": "Rider bike photos",
  "rider.bikeCardUrl": "Rider bike registration cards",
  "storeDocument.url": "Store sign-up documents",
  "paymentProof.imageUrl": "Payment receipts",
  "remittanceSubmission.proofUrl": "Rider remittance proofs",
};

/**
 * Super Admin: move identity documents and proofs uploaded before the private
 * bucket into it, then remove the old public copies.
 */
export default function AdminPrivateFilesPage() {
  const toast = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"" | "move" | "delete-public">("");
  const [log, setLog] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/private-files", { cache: "no-store" });
    const d = await res.json();
    if (!d.success) {
      toast.error(d.error || "Could not load");
      return;
    }
    setReport(d.data);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: "move" | "delete-public") {
    setBusy(action);
    setLog([]);
    try {
      // Small batches until nothing is left (each request stays short).
      for (let round = 0; round < 200; round++) {
        const res = await fetch("/api/admin/private-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const d = await res.json();
        if (!d.success) {
          toast.error(d.error || "Something went wrong");
          break;
        }
        const r = d.data;
        const line =
          action === "move"
            ? `Moved ${r.moved}${r.missing.length ? `, ${r.missing.length} already missing` : ""}${r.failed ? `, ${r.failed} failed` : ""}. ${r.remaining} left.`
            : `Removed ${r.deleted} public copies${r.kept ? `, kept ${r.kept} (private copy not confirmed)` : ""}. ${r.remaining} left.`;
        setLog((l) => [...l, line]);
        const progress = action === "move" ? r.moved : r.deleted;
        if (r.remaining === 0 || progress === 0) break;
      }
      toast.success("Done");
    } catch {
      toast.error("Connection problem. Please try again.");
    } finally {
      setBusy("");
      void load();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Private documents</h1>
        <p className="mt-1 text-sm text-ink-muted">
          CNIC photos, rider documents, store sign-up documents and payment proofs are kept in a private bucket and open
          only for admins and the person they belong to. Documents uploaded before this was set up are still public:
          move them here, check that a few open from the Riders and Stores pages, then remove the old public copies.
        </p>
      </div>

      {!report ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          {!report.configured && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              The private bucket is not set up yet (NEON_STORAGE_PRIVATE_BUCKET in Vercel).
            </p>
          )}

          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-bold text-ink">1. Still public</h2>
            {report.pendingTotal === 0 ? (
              <p className="mt-2 text-sm text-emerald-700">Nothing left to move.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {Object.entries(report.pending).map(([k, n]) => (
                  <li key={k}>
                    {LABELS[k] || k}: <strong>{n}</strong>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={!report.configured || report.pendingTotal === 0 || busy !== ""}
              onClick={() => run("move")}
              className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === "move" ? "Moving…" : `Move ${report.pendingTotal} to private`}
            </button>
          </section>

          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-bold text-ink">2. Old public copies</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {report.publicCopiesLeft} moved document{report.publicCopiesLeft === 1 ? "" : "s"} still have a public copy.
              Remove them only after checking that moved documents open. This cannot be undone; a copy is removed only
              when its private copy is confirmed.
            </p>
            <button
              type="button"
              disabled={!report.configured || report.publicCopiesLeft === 0 || busy !== ""}
              onClick={() => {
                if (window.confirm(`Permanently delete ${report.publicCopiesLeft} public copies? Their old links will stop working.`)) {
                  void run("delete-public");
                }
              }}
              className="mt-4 rounded-xl border-2 border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 hover:border-red-300 disabled:opacity-50"
            >
              {busy === "delete-public" ? "Removing…" : "Remove public copies"}
            </button>
          </section>

          {log.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-surface-muted p-4 text-xs text-ink-muted">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
