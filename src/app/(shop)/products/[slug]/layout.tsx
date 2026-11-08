import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";

/** Product page title / description / share image (QA K1): "Daal mash — Rs 400 | MandiBazaar". */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const p = await prisma.product.findFirst({
      where: {
        OR: [{ slug: params.slug }, { id: params.slug }],
        status: "ACTIVE",
        store: { status: "APPROVED" },
      },
      select: {
        name: true,
        slug: true,
        unit: true,
        price: true,
        salePrice: true,
        shortDescription: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        store: { select: { name: true } },
        images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    });
    if (!p) return { title: "Product unavailable", robots: { index: false } };

    const price = toNumber(p.price);
    const sale = p.salePrice != null ? toNumber(p.salePrice) : null;
    const pays = sale != null && sale < price ? sale : price;
    const priceText = `Rs ${Math.round(pays).toLocaleString("en-PK")}`;
    const title = `${(p.seoTitle || p.name).trim()} — ${priceText}`;
    const rawDesc =
      p.seoDescription ||
      p.shortDescription ||
      p.description ||
      `${p.name} (${p.unit}) for ${priceText} from ${p.store.name}.`;
    const description = `${rawDesc.replace(/\s+/g, " ").trim().slice(0, 155)}`;
    const image = p.images[0]?.url;
    return {
      title,
      description,
      alternates: { canonical: `/products/${p.slug}` },
      openGraph: {
        title: `${title} | MandiBazaar`,
        description,
        type: "website",
        siteName: "MandiBazaar",
        url: `/products/${p.slug}`,
        ...(image ? { images: [{ url: image, alt: p.name }] } : {}),
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title: `${title} | MandiBazaar`,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return { title: "Product" };
  }
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
