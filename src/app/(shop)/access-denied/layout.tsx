import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access denied",
  description: "This page is for a different type of account.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
