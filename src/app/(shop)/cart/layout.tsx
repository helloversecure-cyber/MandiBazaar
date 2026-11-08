import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your cart",
  description: "Review the items in your MandiBazaar cart before checkout.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
