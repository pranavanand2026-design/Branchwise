/** @type {import('tailwindcss').Config} */
// Brand palette: navy #243C4C, steel blue #5289AD, sea grey #ACBCBF, slate #698696, mint white #F4FCFB.
// Display type: Reglo Bold (OFL). Text: IBM Plex Sans.
export default {
  content: ["./app.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#F4FCFB",
          panel: "#ffffff",
          elevated: "#E4EEEE",
          border: "rgba(36,60,76,0.14)",
        },
        fg: {
          primary: "#243C4C",
          secondary: "#3B5566",
          tertiary: "#516C7C",
        },
        accent: {
          DEFAULT: "#243C4C",   // primary buttons
          hover: "#1A2D3A",
          soft: "#E3EEF5",
          ink: "#ffffff",
          blue: "#5289AD",      // brand accent: focus, highlights, map
          link: "#2E6A93",      // steel blue, darkened for readable text
        },
        brand: {
          navy: "#243C4C",
          blue: "#5289AD",
          sea: "#ACBCBF",
          slate: "#698696",
          mint: "#F4FCFB",
        },
        score: {
          strong: "#2E6A93",
          good: "#5289AD",
          mixed: "#7E949C",
          weak: "#A0614B",
        },
        danger: { DEFAULT: "#B3261E", soft: "#FBECEB" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        display: ['"Reglo"', '"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { sm: "8px", md: "12px", lg: "20px" },
      boxShadow: {
        panel: "0 1px 2px rgba(36,60,76,0.05), 0 8px 24px rgba(36,60,76,0.08)",
        pop: "0 12px 40px rgba(36,60,76,0.18)",
      },
      letterSpacing: { display: "-0.01em" },
    },
  },
  plugins: [],
};
