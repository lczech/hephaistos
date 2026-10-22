// For tests in a real browser: the page's look, as `main.tsx` loads it, for sizes as shown.
import "../theme.css";
import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    workers: boolean; // whether the browser's tests have Web Workers (`vitest.config.ts`)
  }
}

// WebKit's tests have no workers, so diffs highlight on the page, as where there are none
// (`components/diff/Diff.tsx`). Playwright's WebKit, its WPE build, segfaults now and then when
// several workers load their modules at once, as Vite serves them in tests (about one run in
// six): its bug, https://github.com/microsoft/playwright/issues/43582. Chromium and Firefox test
// the workers.
if (!inject("workers")) Reflect.deleteProperty(globalThis, "Worker");
