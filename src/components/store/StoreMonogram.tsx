import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Tasteful, deterministic gradients so each store gets a consistent brand-adjacent
 * color. Hex pairs (applied via inline style) so they never depend on Tailwind's
 * class purge — dynamically chosen gradient classes would be stripped from the build.
 */
const GRADIENTS: [string, string][] = [
  ["#10b981", "#0d9488"], // emerald → teal
  ["#f59e0b", "#ea580c"], // amber → orange
  ["#0ea5e9", "#4f46e5"], // sky → indigo
  ["#f43f5e", "#db2777"], // rose → pink
  ["#8b5cf6", "#9333ea"], // violet → purple
  ["#84cc16", "#059669"], // lime → emerald
  ["#06b6d4", "#2563eb"], // cyan → blue
  ["#d946ef", "#e11d48"], // fuchsia → rose
];

function pick(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A store's avatar: its logo when set, otherwise a branded initials monogram with a
 * per-store color (no blank placeholder boxes).
 */
export function StoreMonogram({
  name,
  logoUrl,
  size = 64,
  sizeClass,
  textClass = "text-lg",
  rounded = "rounded-xl",
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  sizeClass?: string;
  textClass?: string;
  rounded?: string;
}) {
  const box = cn("relative shrink-0 overflow-hidden", rounded, sizeClass);
  const dims = sizeClass ? {} : { width: size, height: size };
  if (logoUrl && logoUrl.trim()) {
    return (
      <div className={box} style={dims}>
        <Image src={logoUrl} alt={name} fill className="object-cover" sizes={`${size}px`} />
      </div>
    );
  }
  const [from, to] = pick(name);
  return (
    <div
      className={cn(box, "flex items-center justify-center font-black text-white", textClass)}
      style={{ ...dims, backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
