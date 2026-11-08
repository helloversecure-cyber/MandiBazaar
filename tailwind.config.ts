import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ── Semantic, theme-aware tokens (flip in dark mode via CSS vars) ──
           Use these for shells/primitives so one class works in light + dark:
           bg-app, bg-card, bg-elevated, border-line, text-ink / ink-muted / ink-subtle */
        app: "rgb(var(--c-app) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          muted: "rgb(var(--c-ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--c-ink-subtle) / <alpha-value>)",
        },
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        accent: {
          50: "#fff7ed",
          100: "#ffedd5",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
        },
        deal: {
          500: "#ef4444",
          600: "#dc2626",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f0fdf4",
          border: "#d1fae5",
        },
        /* legacy aliases — admin still uses these */
        forest: {
          50: "#f0fdf4",
          100: "#ecfdf5",
          200: "#d1fae5",
          300: "#a7f3d0",
          400: "#6ee7b7",
          500: "#34d399",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        leaf: { 400: "#34d399", 500: "#10b981", 600: "#059669" },
        sand: { 50: "#f0fdf4", 100: "#ecfdf5", 200: "#d1fae5" },
        honey: { 400: "#fb923c", 500: "#f97316", 600: "#ea580c" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        urdu: ["var(--font-urdu)", "serif"],
      },
      keyframes: {
        "brand-name-shine": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "brand-tagline-pulse": {
          "0%, 100%": { opacity: "0.75", transform: "translateY(0)" },
          "50%": { opacity: "1", transform: "translateY(-1px)" },
        },
      },
      animation: {
        "brand-name": "brand-name-shine 4s ease-in-out infinite",
        "brand-tagline": "brand-tagline-pulse 3s ease-in-out infinite",
      },
      boxShadow: {
        soft: "0 12px 40px -12px rgba(6, 78, 59, 0.15)",
        card: "0 1px 3px rgba(6, 78, 59, 0.06), 0 4px 16px -4px rgba(6, 78, 59, 0.08)",
        "card-hover": "0 8px 30px -8px rgba(5, 150, 105, 0.22)",
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #022c22 0%, #064e3b 40%, #047857 100%)",
        "brand-gradient":
          "linear-gradient(135deg, #059669 0%, #10b981 50%, #047857 100%)",
        "deal-gradient":
          "linear-gradient(90deg, #ef4444 0%, #f97316 100%)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
    },
  },
  plugins: [],
};
export default config;
