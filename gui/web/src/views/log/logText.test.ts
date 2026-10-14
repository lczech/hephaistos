import { describe, expect, it } from "vitest";
import { extraFields, levelName, levelTone, processText, tracebackEnd } from "./logText";

const failed = {
  at: "2026-10-12T16:54:38.929Z",
  level: "CRITICAL",
  process: "daemon",
  pid: 4242,
  logger: "hephaistos.daemon",
  message: "unexpected ModuleNotFoundError",
  error:
    "Traceback (most recent call last):\n  …\nModuleNotFoundError: No module named 'uvicorn'\n",
  trigger: "api",
  observed: 7,
};

describe("a log record's parts", () => {
  it("are its level, coloured from warnings on, and its process", () => {
    expect(levelName(failed)).toBe("critical");
    expect(
      ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((level) => levelTone({ level })),
    ).toEqual(["muted", undefined, "warning", "danger", "alarm"]);
    expect(processText(failed)).toBe("daemon[4242]");
    expect(processText({})).toBe("?[?]");
  });

  it("are its other fields, as text, and the end of its traceback", () => {
    expect(extraFields(failed)).toEqual([
      ["trigger", "api"],
      ["observed", "7"],
    ]);
    expect(tracebackEnd(failed)).toBe("ModuleNotFoundError: No module named 'uvicorn'");
    expect(tracebackEnd({ message: "fine" })).toBeUndefined();
  });
});
