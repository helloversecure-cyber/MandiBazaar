import Link from "next/link";
import { Truck, Store, CreditCard, Banknote, Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { prisma } from "@/lib/db";
import { formatPhone, getSiteInfo, rupees, whatsappLink } from "@/lib/shop/site-info";

/** Shop footer — every claim here is true today (QA A3 / P8 / M10) and policy pages are linked (QA A5). */
export async function Footer() {
  const [site, storeCount] = await Promise.all([
    getSiteInfo(),
    prisma.store.count({ where: { status: "APPROVED" } }).catch(() => 0),
  ]);

  const badges = [
    {
      icon: Store,
      title: "Growing network of local stores",
      sub: storeCount > 0 ? `${storeCount} approved store${storeCount === 1 ? "" : "s"}` : "Stores approved by MandiBazaar",
      href: "/stores",
    },
    {
      icon: Truck,
      title: "Delivery to your door",
      sub: `${rupees(site.ratePerKm)}/km go + return · free on ${rupees(site.freeDeliveryThreshold)}+`,
      href: "/faq",
    },
    { icon: CreditCard, title: "JazzCash & Cash on Delivery", sub: "Pay online or at your door", href: "/faq" },
    {
      icon: Banknote,
      title: "Pay for products in cash on delivery",
      sub: "Delivery fee paid online",
      href: "/faq",
    },
  ];

  return (
    <footer className="mt-16 border-t border-line bg-brand-950 text-slate-300">
      <div className="border-b border-white/10 bg-brand-900/50">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
          {badges.map((item) => (
            <Link key={item.title} href={item.href} className="group flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card/10">
                <item.icon className="h-5 w-5 text-accent-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white group-hover:underline">{item.title}</p>
                <p className="text-xs text-ink-subtle">{item.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5 lg:px-6">
        <div className="sm:col-span-2 lg:col-span-1">
          <BrandLogo variant="dark" />
          <p className="mt-3 text-sm leading-relaxed text-ink-subtle">
            Pakistan&apos;s mandi marketplace. Buy groceries from local stores and get them delivered to your door.
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Shop</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/products" className="hover:text-white">All products</Link></li>
            <li><Link href="/products?sort=discount" className="hover:text-white">Deals</Link></li>
            <li><Link href="/stores" className="hover:text-white">All stores</Link></li>
            <li><Link href="/wishlist" className="hover:text-white">Wishlist</Link></li>
            <li><Link href="/account/orders" className="hover:text-white">My orders</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Help &amp; policies</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/about" className="hover:text-white">About us</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact us</Link></li>
            <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
            <li><Link href="/return-policy" className="hover:text-white">Return &amp; refund policy</Link></li>
            <li><Link href="/terms" className="hover:text-white">Terms &amp; conditions</Link></li>
            <li><Link href="/privacy" className="hover:text-white">Privacy policy</Link></li>
          </ul>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
            <Store className="h-3.5 w-3.5" /> Sell &amp; deliver
          </p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/store" className="font-semibold text-emerald-300 hover:text-white">
                Sell on MandiBazaar
              </Link>
            </li>
            <li><Link href="/store-portal" className="hover:text-white">Store portal</Link></li>
            <li><Link href="/onboarding/store?force=1" className="hover:text-white">Store guide</Link></li>
            <li className="pt-1">
              <Link href="/register/rider" className="font-semibold text-emerald-300 hover:text-white">
                Become a rider
              </Link>
            </li>
            <li><Link href="/rider-portal" className="hover:text-white">Rider portal</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Customer support</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {site.whatsapp && (
              <li>
                <a href={whatsappLink(site.whatsapp)} className="flex items-center gap-2 hover:text-white" target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4 shrink-0" /> WhatsApp {formatPhone(site.whatsapp)}
                </a>
              </li>
            )}
            {site.phone && (
              <li>
                <a href={`tel:${site.phone}`} className="flex items-center gap-2 hover:text-white">
                  <Phone className="h-4 w-4 shrink-0" /> {formatPhone(site.phone)}
                </a>
              </li>
            )}
            <li>
              <a href={`mailto:${site.email}`} className="flex items-center gap-2 break-all hover:text-white">
                <Mail className="h-4 w-4 shrink-0" /> {site.email}
              </a>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" /> {site.address}
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-ink-subtle">
        © {new Date().getFullYear()} {site.businessName}. All rights reserved.
      </div>
    </footer>
  );
}
