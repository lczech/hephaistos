# 004: Server

Status: accepted (2026-10-10)

## Context

GUIs reach a Machine only through its Server ([002](002-technology-stack.md)): the Desktop on the same Machine, later another Machine's GUI and the phone.
The Server's address, its authentication and the shape of its API are what they all build on, so they are costly to change.

This ADR records those decisions.
How the Server works on them is described in [docs/daemon/server.md](../daemon/server.md).

## Decision

- **Address:** the Server is a part of the Daemon and listens on `127.0.0.1` only, at `server.port` (8264). Other Machines and the phone reach it through the network, outside our code: an SSH forward, or `tailscale serve`.
- **Someone else's port:** any user of a Machine can listen on a free port of 127.0.0.1 and so receive the token from clients. Our clients send it only to a port that Linux lists as the user's. On a shared Machine, `server.port = 0` takes a free port at each start, so nobody can take it first. A Unix socket would also prevent this, but makes typing commands and forwards harder, and browsers can't use one.
- **Token:** every API request needs this Machine's token. localhost is shared by other users and services, websites in the browser can send requests to it, and Tailscale opens it to the tailnet; the token keeps them all out. Whoever can log in as the user can read it, so SSH is the root of trust. A client fetches the token over SSH when it connects (`hephaistos daemon token`), and never stores another Machine's token. Sync never carries it.
- **Sending it:** only as `Authorization: Bearer <token>`. Not in a cookie: cookies aren't kept apart by port, so a browser would also send it to every other service on localhost, e.g. a Jupyter or a forwarded one. Not in a query: URLs end up in logs. A browser gets it once from a link's fragment, which it never sends.
- **API:** the API returns what the CLI's `--json` prints, built by the same Core functions, so they can't drift apart. Entities are addressed by full ID, as names change. Checkouts' changes, diffs and history come from git each time they're asked, never stored. The OpenAPI schema describes the endpoints, and the GUI generates its types from it.
- **Live:** a WebSocket over which the Server hints at what changed, never with the data: GUIs ask the endpoints again.
- **The GUI's files:** the Server serves the GUI's build, without the token, as the files hold no data. As the page keeps the token, every response forbids it anything but our own files and connections to this Server (Content-Security-Policy). So the GUI uses no CDNs, web fonts or analytics.
- **Version:** `api: {major, minor}`. A change that breaks clients bumps major; one that only adds bumps minor. Until 1.0, while nothing depends on it yet, the API may change in any way, and every change bumps minor. A client requires the same major, and checks minor before using what it added (before 1.0: the same version). URLs carry no version, and no old versions are served while things are in flux.
- **Running:** in the Daemon's process, as an asyncio task (uvicorn), with read sessions.

## Rejected

- **Listening on other interfaces, TLS, accounts:** SSH and Tailscale already connect and encrypt; there is one user.
- **Versions in URLs (`/api/v1/`):** they only pay off when serving old versions side by side.
- **FastAPI as an optional extra:** two ways to install for about 10 MB saved.
