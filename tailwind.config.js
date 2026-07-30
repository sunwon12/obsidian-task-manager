/* ADR-0006: tm- prefix + preflight 비활성화 + Obsidian theme variable 매핑.
 * v4가 prefix/preflight API를 변경하므로 v3 핀.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: "tm-",
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        // Obsidian CSS variable에 매핑하여 다크/라이트 자동 적응
        "tm-bg":         "var(--background-primary)",
        "tm-bg-alt":     "var(--background-secondary)",
        "tm-bg-hover":   "var(--background-modifier-hover)",
        "tm-text":       "var(--text-normal)",
        "tm-muted":      "var(--text-muted)",
        "tm-faint":      "var(--text-faint)",
        "tm-accent":     "var(--interactive-accent)",
        "tm-accent-hover": "var(--interactive-accent-hover)",
        "tm-border":     "var(--background-modifier-border)",
        "tm-error":      "var(--text-error)",
        "tm-success":    "var(--text-success)",
        "tm-warning":    "var(--text-warning)",
      },
    },
  },
  plugins: [],
};
