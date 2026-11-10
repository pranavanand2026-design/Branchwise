/** @type {import('tailwindcss').Config} */
// Tokens match the landing page's dealt palette (taste kit: mint-pink-accounts, IBM Plex, soft radius).
export default {
  content: ["./app.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#f8f8f8",
          panel: "#ffffff",
          elevated: "#eeeeee",
          border: "rgba(10,10,10,0.12)",
        },
        fg: {
          primary: "#0a0a0a",
          secondary: "#3d3d3d",
          tertiary: "#6a6a6a",
        },
        accent: {
          DEFAULT: "#1f6b3a",
          hover: "#17552e",
          soft: "#e5efe8",
          ink: "#ffffff",
        },
        score: {
          high: "#2f8a52",
          mid: "#c98317",
          low: "#c2473b",
        },
        danger: { DEFAULT: "#b3261e", soft: "#fbeceb" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "20px",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(10,10,10,0.04), 0 8px 24px rgba(10,10,10,0.06)",
        pop: "0 12px 40px rgba(10,10,10,0.14)",
      },
      letterSpacing: {
        display: "-0.025em",
      },
    },
  },
  plugins: [],
};
