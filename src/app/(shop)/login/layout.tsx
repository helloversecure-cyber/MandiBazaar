import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your MandiBazaar account.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
