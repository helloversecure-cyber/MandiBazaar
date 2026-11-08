import Link from "next/link";
import { SearchX } from "lucide-react";

/** Branded "page not found" body (QA A6). */
export function NotFoundContent() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center sm:py-24">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <SearchX className="h-8 w-8" />
      </div>
      <p className="text-sm font-bold uppercase tracking-widest text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-extrabold text-ink sm:text-3xl">Oops, page not found</h1>
      <p className="mt-3 text-sm text-ink-subtle">
        The page you&apos;re looking for doesn&apos;t exist or has moved. Let&apos;s get you back to shopping.
      </p>
      <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          Go to homepage
        </Link>
        <Link
          href="/products"
          className="inline-flex items-center justify-center rounded-xl border-2 border-line bg-card px-6 py-3 text-sm font-semibold text-ink hover:border-brand-300 hover:bg-brand-50"
        >
          Browse products
        </Link>
      </div>
    </div>
  );
}
