import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My wishlist",
  description: "Products you saved on MandiBazaar.",
  robots: { index: false, follow: false },
};

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
