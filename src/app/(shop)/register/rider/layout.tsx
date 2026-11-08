import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Become a rider",
  description: "Apply to deliver with MandiBazaar.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
