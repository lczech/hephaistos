import { defineConfig } from "vitest/config";

// The GUI in a simulated browser, with its Vite config; the Desktop's main process in Node.
export default defineConfig({
  test: {
    projects: [
      "web/vite.config.ts",
      { test: { name: "desktop", root: "desktop", environment: "node" } },
    ],
  },
});
