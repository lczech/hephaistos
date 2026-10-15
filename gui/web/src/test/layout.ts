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
