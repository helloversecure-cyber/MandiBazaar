import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Send a list to stores",
  description: "Write what you need and nearby stores send you their prices.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
