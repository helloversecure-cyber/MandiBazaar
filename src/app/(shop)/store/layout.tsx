import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sell on MandiBazaar",
  description: "Sign in to your store or apply to sell on MandiBazaar.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
