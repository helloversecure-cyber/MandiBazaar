"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn } from "@/lib/utils";

/** Sun/moon switch. Icon shows the theme you'll switch TO.
 *  `bare` drops the bordered card background so it can sit inline with other
 *  ghost icon buttons (e.g. the storefront header). */
export function ThemeToggle({ className, bare = false }: { className?: string; bare?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={cn(
        "press inline-flex items-center justify-center transition",
        bare
          ? "rounded-lg p-2.5 text-ink-muted hover:bg-app hover:text-ink"
          : "h-9 w-9 rounded-xl border border-line bg-card text-ink-muted hover:border-brand-300 hover:text-ink",
        className
      )}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
