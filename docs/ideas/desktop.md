# Ideas: the Desktop and other applications

## Launchers

Later and unnumbered ([roadmap](../plans/roadmap.md)): open a Checkout in the editor, a Terminal emulator or the file manager.
A systemd Daemon started before login lacks `DISPLAY`, `WAYLAND_DISPLAY` and D-Bus: `systemd-run --user`, the environment of the graphical session, or Electron launching on its own Machine.
From the Explorer (user, 2026-11-06: once the Explorer is finished): row menu entries "Open with default app" (`gio open` or `xdg-open`) and "Open terminal here" (the Terminal emulator of the system).
They need a Server endpoint that writes, run in the graphical session, with an `Origin` check ([daemon](daemon.md#the-server)).
The first action that launches anything is grilled on its own.

## The tray

Deferred to Agents and the inbox: show and hide, open in the browser, start or restart the Daemon, quit.
Decide then whether closing keeps it in the tray, and where notifications come from.
Ubuntu needs the AppIndicator extension.
A thin client of the Server API.

## Caches of the Desktop

Seen 2026-11-13: the Desktop profile (`desktop/` in the state directory) held 510 MB, nearly all of it the HTTP cache of Chromium (374 MB) and the V8 code cache (129 MB).
Each build of the GUI names its assets anew, and the cache keeps every version, so it grows mostly on the Machine of a developer.
Chromium caps these caches by the free disk space, at hundreds of MB; the GUI comes from localhost, so they gain little.
Cap them lower (`--disk-cache-size`), or clear them when the GUI changes (`session.clearCache()`, `clearCodeCaches()`).

## Addresses on the command line

Agreed 2026-10-15: `hephaistos browse <address>` and `hephaistos desktop open <address>`.
