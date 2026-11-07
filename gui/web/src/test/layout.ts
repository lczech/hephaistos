/** A saved Layout: one Group holding a Panel for each of these kinds of View. */
export function saveViews(...kinds: string[]): void {
  const panels = Object.fromEntries(
    kinds.map((kind, i) => {
      const id = `${i}`;
      return [id, { id, contentComponent: "view", title: kind, params: { kind, params: {} } }];
    }),
  );
  const ids = Object.keys(panels);
  const leaf = { type: "leaf", data: { views: ids, activeView: ids[0], id: "1" }, size: 800 };
  const grid = {
    root: { type: "branch", data: [leaf], size: 600 },
    width: 800,
    height: 600,
    orientation: "HORIZONTAL",
  };
  localStorage.setItem("hephaistos.layout", JSON.stringify({ format: 2, dock: { grid, panels } }));
}

/** A Group of tabs, each named as its View's kind; a name ending in "*" is a preview. */
export interface TabsSpec {
  tabs: string[];
  size?: number; // across the split it is in, in pixels as dockview saves them
}

/** A Group, or a split of them: across the one it is in, starting side by side at the top. */
export type GridSpec = TabsSpec | GridSpec[];

/** A saved Layout of Groups as `spec` places them, its top side by side or one above another. */
export function saveGrid(spec: GridSpec[], orientation: "HORIZONTAL" | "VERTICAL"): void {
  const panels: Record<string, object> = {};
  let groups = 0;
  const node = (part: GridSpec): object => {
    if (Array.isArray(part)) return { type: "branch", data: part.map(node), size: 100 };
    const views = part.tabs.map((tab) => {
      const kind = tab.replace(/\*$/, "");
      const preview = tab.endsWith("*") ? { preview: true } : {};
      panels[kind] = {
        id: kind,
        contentComponent: "view",
        title: kind,
        params: { kind, params: {}, ...preview },
      };
      return kind;
    });
    groups += 1;
    const data = { views, activeView: views[0], id: `${groups}` };
    return { type: "leaf", data, size: part.size ?? 100 };
  };
  const grid = {
    root: { type: "branch", data: spec.map(node), size: 600 },
    width: 800,
    height: 600,
    orientation,
  };
  localStorage.setItem("hephaistos.layout", JSON.stringify({ format: 2, dock: { grid, panels } }));
}
