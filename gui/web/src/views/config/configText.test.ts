import { describe, expect, it } from "vitest";
import type { Schemas } from "../../api/client";
import { appliedText, sourceRows, sourceText, valueText } from "./configText";

const setting: Schemas["SettingJson"] = {
  key: "git.timeout",
  description: "Seconds one git command may take.",
  type: "float",
  value: 90,
  source: "/home/me/.config/hephaistos/config.toml",
  applied: 30,
};

describe("a setting", () => {
  it("shows its value and source as `config show` does", () => {
    expect(valueText(true, "bool")).toBe("true");
    expect(valueText(3, "int")).toBe("3");
    expect([valueText(60, "float"), valueText(0.5, "float")]).toEqual(["60.0", "0.5"]);
    expect(valueText("auto", "text")).toBe("auto");
    expect(sourceText(setting.source)).toBe("config.toml");
    expect(sourceText("HEPHAISTOS_GIT_TIMEOUT")).toBe("HEPHAISTOS_GIT_TIMEOUT");
    expect(sourceText("default")).toBe("default");
  });

  it("says what the Daemon applies until it restarts", () => {
    expect(appliedText(setting)).toBe("The Daemon uses 30.0 until it restarts.");
    expect(appliedText({ ...setting, applied: 90 })).toBeUndefined();
  });
});

describe("the sources", () => {
  it("are in the order they apply, then other hosts' files and unknown variables", () => {
    const rows = sourceRows(
      {
        host: "laptop",
        settings: [],
        sources: [
          {
            source: "/home/me/.config/hephaistos/config.toml",
            kind: "file",
            state: "broken",
            error: "config.toml: line 2: expected '='",
          },
          { source: "HEPHAISTOS_GIT_TIMEOUT", kind: "variable", state: "read", error: null },
        ],
        other_hosts: ["/home/me/.config/hephaistos/config.cluster.toml"],
        unknown_variables: [{ name: "HEPHAISTOS_GIT_TIMOUT", closest: "HEPHAISTOS_GIT_TIMEOUT" }],
      },
      "/home/me",
    );
    expect(rows).toEqual([
      {
        source: "~/.config/hephaistos/config.toml",
        state: "broken",
        tone: "danger",
        error: "config.toml: line 2: expected '='",
      },
      { source: "HEPHAISTOS_GIT_TIMEOUT", state: "read", tone: undefined, error: undefined },
      {
        source: "~/.config/hephaistos/config.cluster.toml",
        state: "other host (unused here)",
        tone: "muted",
      },
      {
        source: "HEPHAISTOS_GIT_TIMOUT",
        state: "unknown (did you mean HEPHAISTOS_GIT_TIMEOUT?)",
        tone: "warning",
      },
    ]);
  });
});
