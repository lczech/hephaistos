# 004: Server

Status: accepted (2026-10-10)

## Context

GUIs reach a Machine only through its Server ([002](002-technology-stack.md)): the Desktop on the same Machine, later another Machine's GUI and the phone. The Server's address, its authentication and the shape of its API are what they all build on, so they are costly to change.

## Decision

- **Address:** the Server is a part of the Daemon (`server.enabled`, on by default) and listens on `127.0.0.1` only, at `server.port` (8264). Other Machines and the phone reach it through the network, outside our code: `ssh -L 8264:localhost:8264 <machine>`, or `tailscale serve`. A port already in use fails only the Server, which is retried like any crashed part; `server.port` per host fixes it. A client learns another Machine's port by asking over SSH (`daemon status --json`).
- **Token:** every request needs this Machine's token: 32 random bytes as URL-safe base64, in `server.token` in the data directory, mode 0600, created on first use. localhost is shared by other users and services, websites in the browser can send requests to it, and Tailscale opens it to the tailnet; the token keeps them all out. Whoever can log in as the user can read it, so SSH is the root of trust: a client fetches it over SSH (`hephaistos daemon token`) when it connects, never stores another Machine's token, and Sync never carries it. `daemon token --renew` replaces it; the Server reads it again when the file changes.
- **Sending it:** `Authorization: Bearer <token>`, or a cookie for browsers. Opening `/?token=<token>` once sets the cookie (`HttpOnly`, `SameSite=Strict`, a year) and redirects to the URL without it; browsers can't add headers to WebSockets, but send cookies. Requests must name `localhost` or `127.0.0.1` as their host, against DNS rebinding. Tokens are compared in constant time; refusals are logged as warnings, never with the token.
- **API:** the API returns what the CLI's `--json` prints, built by the same Core functions (`core/views.py`, TypedDicts), so they can't drift apart. Entities are addressed by full ID, as names change; other entities are referred to as `{id, name}`. Lists come whole, except Events, which page back with `before=<id>`. Errors are `{"error": "<the CLI's message>"}` with 400, 401 or 404; unexpected ones are 500, their traceback only in the log. FastAPI describes the endpoints at `/docs`; this document doesn't list them.
- **Types for the GUI:** the TypedDicts become the API's OpenAPI schema, from which the GUI generates its TypeScript types.
- **Version:** `GET /api/info` gives the running version and `api: {major, minor}` (`API_VERSION` in `core/views.py`). A change that breaks clients bumps major; one that only adds bumps minor. A client requires the same major, and checks minor before using what it added. A test holds the schema to a recorded snapshot and requires the right bump. URLs carry no version, and no old versions are served while things are in flux.
- **Running:** in the Daemon's process, as an asyncio task (uvicorn), its endpoints in threads with read sessions. FastAPI and uvicorn are regular dependencies, imported only when the Server starts; a test keeps them out of the CLI's start. Each request is logged at DEBUG, its query shown without the token.

## Rejected

- **A Unix socket instead of a port:** browsers can't connect to one, and the far end of an SSH forward is a port again.
- **Listening on other interfaces, TLS, accounts:** SSH and Tailscale already connect and encrypt; there is one user.
- **Versions in URLs (`/api/v1/`):** they only pay off when serving old versions side by side.
- **FastAPI as an optional extra:** two ways to install for about 10 MB saved.
