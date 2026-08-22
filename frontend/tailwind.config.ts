import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        // Pure electric green. Structural/decorative use only — rails,
        // glows, active indicators, focus rings. Never body text on a
        // light surface (fails contrast); use `primary` for that.
        neon: { DEFAULT: "hsl(var(--neon))", foreground: "hsl(var(--neon-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        success: "hsl(var(--success))",
        danger: "hsl(var(--danger))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
      },
      fontFamily: {
        // SF Pro first on Apple platforms — it is what makes the UI read
        // as native macOS rather than "a website". Inter is the
        // cross-platform fallback with near-identical metrics.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        // Display serif for the hero greeting only — system stack, no webfont.
        // Deliberately NOT used for answers/tables (numeric content stays sans/mono).
        serif: ["Georgia", "Songti SC", "Noto Serif SC", "serif"],
        mono: ["SF Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      // Apple's radii are larger and more continuous than the Bootstrap-era
      // 4px default; --radius is 0.75rem, so lg=12px / md=10px / sm=8px.
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 10px)",
      },
      boxShadow: {
        "elev-1": "var(--shadow-1)",
        "elev-2": "var(--shadow-2)",
        "elev-3": "var(--shadow-3)",
        glow: "var(--glow)",
      },
      transitionTimingFunction: {
        // Apple's standard decelerate curve — fast out, gentle settle.
        apple: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
} satisfies Config;
