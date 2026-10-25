// The Desktop: a window showing this Machine's GUI, as its Server serves it. It only integrates
// with the desktop; hephaistos does the rest. Start it with `hephaistos desktop open`.

import { readFileSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
  type WebContents,
} from "electron";
import { onScreen, savedBounds } from "./bounds.js";
import { Connector } from "./connecting.js";
import { runner } from "./hephaistos.js";
import { waitingPage } from "./page.js";
import { destination, type KeyAction, keyAction } from "./rules.js";

const BACKGROUND = { light: "#ffffff", dark: "#1e1e1e" }; // the GUI's, against a white flash
const ZOOM_STEP = 0.5; // a zoom level is 20%
const ABORTED = -3; // a load that a newer one replaced
const SETTLE = 200; // ms after the token file changes, before reading it

/** What `hephaistos desktop open` tells the Desktop. */
function given(name: string): string {
  const value = process.env[name];
  if (value) return value;
  console.error(`error: ${name} isn't set; start the desktop app with \`hephaistos desktop open\``);
  process.exit(2);
}

const executable = given("HEPHAISTOS_EXECUTABLE");
const profile = given("HEPHAISTOS_DESKTOP_PROFILE");
const tokenFile = given("HEPHAISTOS_TOKEN_FILE");
const boundsFile = join(profile, "window.json");

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

let window: BrowserWindow | null = null;
let server: string | null = null; // the origin of the Server whose GUI the window shows
let waiting: string | null = null; // the waiting page shown instead, if any

const connector = new Connector({
  run: runner(executable),
  load(link) {
    server = new URL(link).origin;
    waiting = null;
    void window?.loadURL(link).catch(() => undefined); // failures come as did-fail-load
  },
  show(state) {
    const page = waitingPage(state);
    if (page === waiting) return;
    waiting = page;
    void window?.loadURL(page).catch(() => undefined);
  },
});

function act(action: KeyAction, contents: WebContents): void {
  const zoom = contents.getZoomLevel();
  const actions: Record<KeyAction, () => void> = {
    reload: () => (waiting === null ? contents.reload() : void connector.now()),
    zoomIn: () => contents.setZoomLevel(zoom + ZOOM_STEP),
    zoomOut: () => contents.setZoomLevel(zoom - ZOOM_STEP),
    zoomReset: () => contents.setZoomLevel(0),
    fullScreen: () => window?.setFullScreen(!window.isFullScreen()),
    devTools: () => contents.toggleDevTools(),
    quit: () => app.quit(),
  };
  actions[action]();
}

/** Keeps the page to the Server and our keys; other web pages open in the user's browser. */
function guard(contents: WebContents): void {
  contents.on("will-navigate", (event) => {
    const where = destination(event.url, server);
    if (where === "window") return;
    event.preventDefault();
    if (where === "browser") void shell.openExternal(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (destination(url, server) !== "none") void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("before-input-event", (event, input) => {
    const action = keyAction(input);
    if (action === null) return;
    event.preventDefault();
    act(action, contents);
  });
  // E.g. reloading while the Daemon is stopped: start it.
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== ABORTED && server !== null && url.startsWith(server)) {
      void connector.now();
    }
  });
}

/** A renewed token: the GUI takes the new link without reloading, as a browser tab would. */
function followToken(): void {
  let last = read(tokenFile);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    watch(dirname(tokenFile), (_event, name) => {
      if (name !== basename(tokenFile)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const current = read(tokenFile);
        if (current === last) return;
        last = current;
        void connector.now();
      }, SETTLE);
    });
  } catch {
    // No data directory yet: `hephaistos setup` makes it, and then the Desktop starts anew.
  }
}

function openWindow(): BrowserWindow {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const { maximized, ...bounds } = onScreen(savedBounds(read(boundsFile)), areas);
  const opened = new BrowserWindow({
    ...bounds,
    title: "hephaistos",
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    // Electron's defaults, stated: the page gets no Node and runs in Chromium's sandbox.
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  if (maximized) opened.maximize();
  opened.on("close", () => {
    const { width, height, x, y } = opened.getNormalBounds();
    const saved = { width, height, x, y, maximized: opened.isMaximized() };
    try {
      writeFileSync(boundsFile, JSON.stringify(saved));
    } catch {
      // opens at the last saved place next time
    }
  });
  return opened;
}

app.setPath("userData", profile); // before anything stores there, the single-instance lock first
Menu.setApplicationMenu(null);
if (!app.requestSingleInstanceLock()) {
  app.quit(); // the running Desktop comes to the front instead
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("web-contents-created", (_event, contents) => guard(contents));
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(() => {
    // The GUI needs no camera, notifications or the like; each gets allowed when a feature does.
    session.defaultSession.setPermissionRequestHandler((_contents, _name, answer) => answer(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = openWindow();
    followToken();
    void connector.now();
  });
}
