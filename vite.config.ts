import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const FIO_ORIGIN = "https://rest.fnar.net";

// The app stamps its version into every save file, so it is read from
// package.json rather than kept in a second place that can drift from it.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

/**
 * Injects a Content-Security-Policy into the built page only.
 *
 * The app talks to exactly one remote host, so pinning connect-src to it means
 * a compromised dependency cannot quietly ship the user's plans somewhere else.
 * Dev builds are skipped because Vite's HMR client needs inline scripts and a
 * websocket back to the dev server.
 */
function cspPlugin(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${FIO_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");

  return {
    name: "pu-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// Relative base so one build works unmodified from a GitHub Pages subpath
// (user.github.io/repo/) and from Electron's file:// protocol.
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
