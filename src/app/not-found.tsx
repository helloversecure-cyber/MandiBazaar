import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { NotFoundContent } from "@/components/shop/NotFoundContent";
import { getSiteInfo } from "@/lib/shop/site-info";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

/** Any unknown URL — branded 404 with the normal shop header and footer (QA A6). */
export default async function NotFound() {
  const site = await getSiteInfo();
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <Header freeDeliveryThreshold={site.freeDeliveryThreshold} ratePerKm={site.ratePerKm} />
      <main className="flex-1 pb-[72px] lg:pb-0">
        <NotFoundContent />
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
