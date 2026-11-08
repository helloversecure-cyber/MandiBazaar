import type { Metadata } from "next";
import AccountLayoutClient from "./AccountLayoutClient";

// Server wrapper so account pages get their own tab title (QA K1); private pages are not indexed.
export const metadata: Metadata = {
  title: "My account",
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountLayoutClient>{children}</AccountLayoutClient>;
}
