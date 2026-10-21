import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

// What a browser shows that a simulated one can't, e.g. sizes, scrolling and what the diff
// renderer draws: tested in real ones, by Playwright's own builds (`npm run fetch-browsers`,
// which names the system libraries missing, e.g. WebKit's).
const BROWSER_TESTS = "src/**/*.browser.test.tsx";
const browsers = ["chromium", "firefox", "webkit"] as const;

// The GUI with its Vite config: in a simulated browser, and those of its tests that need a real
// one in real ones; the Desktop's main process in Node.
export default defineConfig({
  test: {
    projects: [
      {
        extends: "web/vite.config.ts",
        test: {
          name: "web",
          root: "web",
          environment: "jsdom",
          setupFiles: ["src/test/setup.ts"],
          exclude: [...configDefaults.exclude, BROWSER_TESTS],
        },
      },
      {
        extends: "web/vite.config.ts",
        // Its packages bundled anew each run, as in CI: found later, e.g. by a new test, they
        // would reload the page under the tests running. In a cache of its own, as that empties
        // it: a shared one, the other projects' files would be compiled anew too, slowly.
        optimizeDeps: { force: true },
        cacheDir: "../node_modules/.vite/browser",
        test: {
          name: "browser",
          root: "web",
          include: [BROWSER_TESTS],
          setupFiles: ["src/test/setup.ts", "src/test/browser.ts"],
          // After the others, not beside them: sharing the cores, each side's waits time out.
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            viewport: { width: 1280, height: 800 },
            instances: browsers.map((browser) => ({ browser })),
          },
        },
      },
      { test: { name: "desktop", root: "desktop", environment: "node" } },
    ],
  },
});
