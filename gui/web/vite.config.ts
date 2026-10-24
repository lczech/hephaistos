import { readFileSync } from "node:fs";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API version this GUI is built for, from the schema its types come from.
const schema = JSON.parse(readFileSync(new URL("openapi.json", import.meta.url), "utf8"));

// React's compiler memoizes every component and hook, so that a change re-renders only what it
// changes, without memo, useMemo or useCallback by hand. Strictly: a component or hook it can't
// compile, e.g. one breaking the Rules of React, or one it is told to skip ("use no memo"),
// fails the build and the tests, rather than staying slow unnoticed; so does a component it
// compiles caching nothing, as when a value it makes is handed to a function the compiler can't
// see into, which might change it (a hook may have nothing to cache; a test's helpers don't
// count). Through Babel 7: the compiler misreads Babel 8's syntax trees ("Todo: …
// AssignmentPattern" for default values).
const compiler = reactCompilerPreset({
  panicThreshold: "all_errors",
  logger: {
    logEvent(filename, event) {
      if (event.kind === "CompileSkip" || event.kind === "PipelineError") {
        const where = event.fnLoc ? `${filename}:${event.fnLoc.start.line}` : filename;
        const why = event.kind === "CompileSkip" ? event.reason : event.data;
        throw new Error(`React Compiler: not compiled, ${where}: ${why}`);
      }
      const component =
        event.kind === "CompileSuccess" &&
        /^[A-Z]/.test(event.fnName ?? "") &&
        !/\.test\.tsx?$/.test(filename ?? "");
      if (component && event.memoSlots === 0) {
        const where = event.fnLoc ? `${filename}:${event.fnLoc.start.line}` : filename;
        throw new Error(`React Compiler: ${event.fnName} caches nothing, ${where}`);
      }
    },
  },
});

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname, // also when started from the package, as `vite web` or a project
  plugins: [react(), babel({ presets: [compiler] })],
  define: { __API_VERSION__: JSON.stringify(schema.info.version) },
  // Served by this Machine's Server and kept by the browser: one script is fine at this size.
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: "es" }, // the diff renderer's highlighting worker imports its modules
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The Daemon's Server; not for Vitest's (mode `test`), so that no test reaches a real one.
    ...(mode !== "test" && { proxy: { "/api": { target: "http://127.0.0.1:8264", ws: true } } }),
  },
}));
