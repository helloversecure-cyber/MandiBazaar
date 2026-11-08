import type { Metadata } from "next";
import OnboardingLayoutClient from "./OnboardingLayoutClient";

// Server wrapper so the welcome tour gets its own tab title (QA K1).
export const metadata: Metadata = {
  title: "How MandiBazaar works",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingLayoutClient>{children}</OnboardingLayoutClient>;
}
