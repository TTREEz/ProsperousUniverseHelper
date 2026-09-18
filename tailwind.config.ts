import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1419",
          raised: "#161d24",
          overlay: "#1d262f",
        },
        edge: {
          DEFAULT: "#2a3541",
          strong: "#3a4856",
        },
        accent: {
          DEFAULT: "#4ea3ff",
          muted: "#2d6fb3",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
