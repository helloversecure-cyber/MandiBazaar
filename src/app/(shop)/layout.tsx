import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileNav } from "@/components/layout/MobileNav";
import { FreeDeliveryAlert } from "@/components/layout/FreeDeliveryAlert";
import { getSiteInfo } from "@/lib/shop/site-info";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const site = await getSiteInfo();
  return (
    <div className="flex min-h-screen flex-col bg-app">
      <Header
        freeDeliveryThreshold={site.freeDeliveryThreshold}
        ratePerKm={site.ratePerKm}
      />
      <FreeDeliveryAlert />
      <main className="flex-1 pb-[72px] lg:pb-0">{children}</main>
      <Footer />
      <MobileNav />
    </div>
  );
}
