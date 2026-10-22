// For tests in a real browser: the page's look, as `main.tsx` loads it, for sizes as shown.
import "../theme.css";
import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    workers: boolean; // whether the browser's tests have Web Workers (`vitest.config.ts`)
  }
}

// WebKit's tests have no workers, so diffs highlight on the page, as where there are none
// (`components/diff/Diff.tsx`). Playwright's WebKit, its WPE build, segfaults now and then while
// workers highlight (a null pointer in libWPEWebKit, about one run in six): its bug, as no page
// should be able to crash it. Chromium and Firefox test the workers.
if (!inject("workers")) Reflect.deleteProperty(globalThis, "Worker");
