# Desktop

How the Desktop loads the GUI, what its window allows, and what it installs ([ADR 002](../decisions/002-technology-stack.md)).
Its code is in two places: `src/hephaistos/desktop/` starts it and installs what it needs; `gui/desktop/` is Electron's main process around `gui/web/`.

## Loading the GUI

The Desktop loads the GUI from this Machine's Server through `hephaistos daemon token --url`, as a browser would.
It never loads a copy of its own, so the token, the Content-Security-Policy and the Server's checks apply unchanged ([Server](../daemon/server.md)).
When the Server can't be reached, it starts the installed Daemon through systemd, saying why meanwhile.
It follows a renewed token by watching its file.

## The window

The page stays on the Server; other web pages open in the browser.
The page gets no Node, and is refused permission requests.
The window keeps only reload, zoom, full screen, developer tools and quit as its keys; all others reach the page.
One Desktop runs per `HEPHAISTOS_HOME`, with its profile in the state directory.

## Installing

`desktop install` writes its launcher entry and icon, named as Electron's app ID, so that the dock shows them for its window.
Ubuntu lets only programs with an AppArmor profile use Chromium's sandbox.
So `desktop install` also writes a profile for Electron's binary and, if the user agrees, installs it with `sudo -k`.
The profile counts as installed when its rules match, whatever its comments say.
