import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Reset your MandiBazaar password.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
