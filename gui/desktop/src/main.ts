// The Desktop: a window showing this Machine's GUI, as its Server serves it. It only integrates
// with the desktop; hephaistos does the rest. Start it with `hephaistos desktop open`.

import { readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import { guard, refusePermissions, WEB_PREFERENCES } from "./guard.js";
import { runner } from "./hephaistos.js";
import { waitingPage } from "./page.js";
import type { KeyAction } from "./rules.js";
import { buttonColours, TITLE_BAR_HEIGHT } from "./titleBar.js";
import { followToken } from "./tokenFile.js";

const BACKGROUND = { light: "#ffffff", dark: "#1e1e1e" }; // as in the GUI, against a white flash
const ZOOM_STEP = 0.5; // a zoom level is 20%

/** What `hephaistos desktop open` tells the Desktop. */
function given(name: string): string {
  const value = process.env[name];
  if (value) return value;
  console.error(
    `error: ${name} is not set; start the desktop app with \`hephaistos desktop open\``,
  );
  process.exit(2);
}

const executable = given("HEPHAISTOS_EXECUTABLE");
const profile = given("HEPHAISTOS_DESKTOP_PROFILE");
const tokenFile = given("HEPHAISTOS_TOKEN_FILE");
// Optional, e.g. a worktree's name from `scripts/worktree_gui.sh`: tells its window apart.
const label = process.env.HEPHAISTOS_DESKTOP_LABEL;
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

function openWindow(): BrowserWindow {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const { maximized, ...bounds } = onScreen(savedBounds(read(boundsFile)), areas);
  const opened = new BrowserWindow({
    ...bounds,
    title: label ? `hephaistos · ${label}` : "hephaistos",
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    // No title bar from the system: the GUI draws its own, Chromium the window buttons.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      ...buttonColours(null, nativeTheme.shouldUseDarkColors),
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: WEB_PREFERENCES,
  });
  if (maximized) opened.maximize();
  // The GUI says its bar's colour as its theme colour; the window's buttons take it.
  opened.webContents.on("did-change-theme-color", (_event, colour) => {
    opened.setTitleBarOverlay(buttonColours(colour, nativeTheme.shouldUseDarkColors));
  });
  // The title of the page replaces that of the window, unless kept: then the label stays in it.
  if (label) opened.on("page-title-updated", (event) => event.preventDefault());
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
  app.on("web-contents-created", (_event, contents) =>
    guard(contents, {
      server: () => server,
      openExternal: (url) => void shell.openExternal(url),
      act,
      reconnect: () => void connector.now(),
    }),
  );
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(() => {
    // The GUI needs no camera, notifications or the like; each gets allowed when a feature does.
    refusePermissions(session.defaultSession);
    window = openWindow();
    // A renewed token: the GUI takes the new link without reloading, as a browser tab would.
    followToken(tokenFile, () => void connector.now(), { watch, read });
    void connector.now();
  });
}
