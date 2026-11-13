import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

// One run at a time in a checkout: two clash, on the cache of the browser tests below, which each
// empties, and they would share the cores of the laptop besides. A second waits for the first,
// whose process ID is in the lock until it ends; the lock of a run that ended without removing
// it, e.g. killed, is taken over.
const LOCK = new URL("node_modules/.vitest-run.lock", import.meta.url);

function running(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // alive, of another user
  }
}

async function oneRunAtATime(): Promise<void> {
  const own = String(process.pid);
  const mine = new URL(`node_modules/.vitest-run.${own}`, import.meta.url);
  let said = false;
  for (;;) {
    // Made whole, then linked in its place: one finding it there finds the ID in it too.
    writeFileSync(mine, own);
    try {
      linkSync(mine, LOCK);
      process.on("exit", () => {
        if (holderOf() === own) unlinkSync(LOCK);
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      unlinkSync(mine);
    }
    const holder = holderOf();
    if (holder === undefined) continue; // removed meanwhile
    if (holder === own) return; // this config loaded again in the same run
    if (!running(Number(holder))) {
      if (holderOf() === holder) unlinkSync(LOCK);
      continue;
    }
    if (!said) console.error(`Waiting for the test run ${holder} in this checkout to end…`);
    said = true;
    await sleep(1000);
  }
}

function holderOf(): string | undefined {
  try {
    return readFileSync(LOCK, "utf8");
  } catch {
    return undefined;
  }
}

await oneRunAtATime();

// What a browser shows that a simulated one cannot, e.g. sizes, scrolling and what the diff
// renderer draws: tested in real ones, by Playwright's own builds (`npm run fetch-browsers`,
// which names the system libraries missing, e.g. those for WebKit).
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
            // WebKit's without workers: `src/test/browser.ts`.
            instances: browsers.map((browser) => ({
              browser,
              provide: { workers: browser !== "webkit" },
            })),
          },
        },
      },
      { test: { name: "desktop", root: "desktop", environment: "node" } },
    ],
  },
});
