import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a MandiBazaar customer account.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
