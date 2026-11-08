import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { themeNoFlashScript } from "@/components/providers/ThemeProvider";

/* Self-hosted fonts (no runtime Google dependency; builds offline).
   Plus Jakarta Sans and Noto Naskh Arabic are variable fonts — one subset file
   covers the whole weight range. */
const jakarta = localFont({
  src: "./fonts/PlusJakartaSans.woff2",
  variable: "--font-sans",
  weight: "400 800",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const display = localFont({
  src: "./fonts/PlusJakartaSans.woff2",
  variable: "--font-display",
  weight: "600 800",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const urdu = localFont({
  src: "./fonts/NotoNaskhArabic.woff2",
  variable: "--font-urdu",
  weight: "400 700",
  display: "swap",
  fallback: ["serif"],
});

export const metadata: Metadata = {
  title: {
    default: "MandiBazaar — Fresh deals from local mandi stores",
    template: "%s | MandiBazaar",
  },
  description:
    "Pakistan's multi-store marketplace. Compare prices, shop from trusted local stores, fast delivery from Rs. 10/km.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "MandiBazaar",
    description: "Shop fresh deals from local mandi stores — one cart, one delivery.",
    type: "website",
    siteName: "MandiBazaar",
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      <body
        className={`${jakarta.variable} ${display.variable} ${urdu.variable} font-sans antialiased bg-app text-ink`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
