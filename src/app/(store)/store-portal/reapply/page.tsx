"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StoreSignupForm } from "@/components/store/StoreSignupForm";

/**
 * Re-apply: a signed-in store owner whose application was rejected (or who has no
 * approved store) submits a fresh store application. Lives under /store-portal so
 * the middleware lets an unapproved owner reach it; the store-portal layout
 * renders this page instead of the Pending Approval screen.
 */
export default function ReapplyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/80 to-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/store-portal"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-subtle hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-ink">Submit a new application</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Fill in your store details again. MandiBazaar will review the new application and
            approve it if everything checks out.
          </p>
        </div>
        <StoreSignupForm />
      </div>
    </div>
  );
}
