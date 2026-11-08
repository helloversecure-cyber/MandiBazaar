"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  href?: string;
  className?: string;
  /** Light text for dark backgrounds (footer) */
  variant?: "light" | "dark";
  size?: "md" | "lg";
};

export function BrandLogo({
  href = "/",
  className,
  variant = "light",
  size = "lg",
}: Props) {
  const onDark = variant === "dark";
  const basketClass = size === "lg" ? "h-14 w-14 sm:h-16 sm:w-16" : "h-12 w-12";

  const inner = (
    <span className={cn("inline-flex items-center gap-0.5 sm:gap-1", className)}>
      <Image
        src="/mandibazaar-basket.png"
        alt=""
        width={128}
        height={128}
        priority
        className={cn(basketClass, "shrink-0 object-contain")}
      />
      <span className="flex w-max min-w-0 flex-col items-stretch justify-center leading-none">
        <span
          className={cn(
            "animate-brand-name whitespace-nowrap font-display text-base font-extrabold tracking-tight sm:text-lg",
            onDark && "animate-brand-name-on-dark"
          )}
        >
          Mandi Bazaar
        </span>
        <span
          dir="rtl"
          lang="ur"
          className={cn(
            "mt-0.5 flex w-full justify-between font-urdu font-medium animate-brand-tagline text-[10px] leading-snug sm:text-[11px]",
            onDark ? "text-emerald-200" : "text-brand-800"
          )}
        >
          <span>گھر</span>
          <span>چلے،</span>
          <span>بچت</span>
          <span>کے</span>
          <span>ساتھ</span>
        </span>
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="shrink-0" aria-label="Mandi Bazaar home">
      {inner}
    </Link>
  );
}
