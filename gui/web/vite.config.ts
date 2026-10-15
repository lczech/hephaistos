import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The API version this GUI is built for, from the schema its types come from.
const schema = JSON.parse(readFileSync(new URL("openapi.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: { __API_VERSION__: JSON.stringify(schema.info.version) },
  // Served by this Machine's Server and kept by the browser: one script is fine at this size.
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8264", ws: true } }, // the Daemon's Server
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
});
