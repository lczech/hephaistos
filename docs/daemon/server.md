# Server

How the Server listens, checks its clients, answers and serves the GUI ([ADR 004](../decisions/004-server.md)).

## Address

The Server is a part of the Daemon (`server.enabled`, on by default).
It listens on `127.0.0.1` at `server.port` (8264).
Other Machines and the phone reach it through the network, outside our code: `ssh -L 8264:127.0.0.1:8264 <machine>`, or `tailscale serve`.
A port already in use fails only the Server, which is retried like any crashed part ([Daemon](daemon.md#running)).
Setting `server.port` for that host fixes it.
A client learns another Machine's port by asking over SSH (`daemon status --json`).

## Someone else's port

Any user of a Machine can listen on a free port of 127.0.0.1, also on 8264 before our Daemon starts.
Clients connecting there would send that user the token.
So our clients send the token only to a port that Linux lists as the user's (`/proc/net/tcp`).
`daemon token --url` refuses otherwise.
A Server that finds its port taken says by whom, and to renew the token.
Our links name `127.0.0.1`, as `localhost` may first try IPv6, where someone else could listen.
curl by hand, forwards set up by hand and the phone don't check.
`browse` checks, but hands the link to the browser on its command line, which other users can read.
On personal Machines only the user has an account.
On a shared one, `server.port = 0` takes a free port at each start, reported once listening, so nobody can take it first.

## Token

The token is 32 random bytes as URL-safe base64.
It is kept in `server.token` in the data directory, mode 0600, and created on first use.
`daemon token --renew` replaces it; the Server reads it again when the file changes.

## Sending the token

Requests send it as `Authorization: Bearer <token>`.
A browser gets it once from a link's fragment, `http://127.0.0.1:8264/#token=<token>` (`daemon token --url`), which it never sends.
The GUI keeps it in the browser's local storage for that origin, and takes it out of the address bar.
It does so also for a link opened in the page later, e.g. the Desktop's after a renewal.
It forgets the token on a 401, unless a newer one came meanwhile.
A live connection is a WebSocket, to which a browser can't add headers, so it sends the token as its first message.
Tokens are compared in constant time.
Refusals are logged as warnings, never with the token.

## Host check

Requests must name `localhost` or `127.0.0.1` as their host, against DNS rebinding.
The check covers all requests, also those for the GUI's files.

## Answers

The API returns what the CLI's `--json` prints, built by the same Core functions (`core/serialize.py`, TypedDicts).
A test requires an endpoint for every command with `--json`.
Entities are addressed by full ID; other entities are referred to as `{id, name}`.
The settings are those the Daemon finds, each with the value it applies.
JSON with something unusual to say, e.g. an outdated schema, says it in `warnings` next to the data.
The OpenAPI schema at `/openapi.json` describes the endpoints; this document doesn't list them.
FastAPI's `/docs` page is off: it runs scripts from a CDN, which would see the token.

## Paging

Lists come whole, with three exceptions:
- Events page back with `before=<id>`;
- the log pages back with `before=<position>`;
- a table's rows page with `offset`.

Paging back, lists by time come newest first, as the CLI's do with `--reverse`.

## Observing

`POST /api/observe` has the Watcher pass ([Watcher](watcher.md)).
It answers 204 once the pass ended, and 503 if it failed.
The other endpoints show what changed.

## Git

Four endpoints have no command:
- `/api/changes`: a Checkout's changes;
- `/api/diff`: a file's change, with git's patch; `context=` sets the lines around each change, as `--unified` does;
- `/api/diff/files`: the file's two versions, to show where the file ends and more around the changes;
- `/api/history`: the file's commits.

They come from git each time they're asked, and are never stored, as `git status`, `git diff` and `git log` already show them in a terminal.
`commit=` asks for what a commit changed against its first parent.
The answer says whether a branch, tag or HEAD still leads to the commit; if not, it says what amends of it led to, by the Events.
Untracked files count as added to the working tree, and as deleted from it.
Bare Clones answer only what compares commits.
Patches and versions come only up to `gui.diff.max_bytes`.
git runs read-only, with no external diff tools.
The Revisions compared are checked with `rev-parse --verify --end-of-options`.

History pages on from where a page ended, and follows a file's renames.
Where a file's history ends, its oldest commit is checked for having renamed it.
`search=` keeps the commits whose message has all its words, as `git log --grep` with `--all-match` does.
It also names the commit of a hash searched for, with where it is.
`everywhere=` walks all branches and tags.
Refs come with their short and full names.

## Errors

Errors are `{"error": "<the CLI's message>", "checkout": …}` with 400, 401, 404 or 410.
Unexpected ones are 500, with their traceback only in the log.
An error about a Clone or Worktree names it in `checkout`, and its Clone too, with which of them is `gone`.
410 is for a Worktree git removed or a Clone unregistered, whose rows stay for their Events.
A Checkout that is only missing, its path empty, is 404, as is an ID never known.
The schema declares this shape as every endpoint's `default` answer.

## Live

`/api/live` is a WebSocket over which the Server hints at what changed, e.g. `{"hints": ["data", "daemon", "log"]}`.
Hints never carry the data; GUIs ask the endpoints again.
While any connection is open, one loop looks every second, and at once after `POST /api/observe`.
It looks at the database's `data_version`, at the Daemon's status except its counts (which asking again changes), and at the log's size.
A heartbeat every 10 s lets GUIs notice a Server that hangs.
With each heartbeat, the loop checks that the clock didn't move without a `data` hint; it logs a change it missed, and hints it.
A client that falls behind is closed, rather than sent fewer hints.
Renewing the token closes all connections.
Browsers let any page open WebSockets to localhost, so a connection with an `Origin` must come from the Server's own page.
Each endpoint names what keeps it current (`KEPT_CURRENT`): a hint, the GUI gaining focus, or reconnecting.
A test holds these names to the endpoints.
The messages are in the OpenAPI schema.

## Types

The TypedDicts become the API's OpenAPI schema, from which the GUI generates its TypeScript types.

## The GUI's files

The Server serves the GUI's build from `gui/web/dist/` in the checkout it runs from: `/` and `/assets/…`.
These need no token, as they hold no data, and a browser can't send a header when opening a link.
Everything else needs the token, the API above all.
Every response sets a Content-Security-Policy, as the page keeps the token:
- only our own files and connections to this Server;
- no inline or foreign scripts, and no framing;
- workers only from this Server; they highlight diffs;
- inline styles, which the diff renderer sets; they can send nothing out, as nothing else may load or connect.

Responses also set `Referrer-Policy: no-referrer` and `nosniff`.
So the GUI uses no CDNs, web fonts or analytics.
`/assets/` is named by content and cached for good; the page is checked each time, so a rebuild needs no Daemon restart.
Without a build, `/` names the build command.

## Version

`GET /api/info` gives the running version, and `api: {major, minor}` (`API_VERSION` in `core/serialize.py`).
A test holds the schema to a recorded snapshot, and requires the right bump.
It refuses 1.x until it has rules that tell requests from answers, as a new required parameter breaks clients and a new value in an answer may.
The GUI knows the version it was built for.
It stops at another major.
For a Daemon with an older minor, or before 1.0 another version, it names `hephaistos daemon restart`.

## Running

The Server runs in the Daemon's process, as an asyncio task (uvicorn).
Its endpoints run in threads, with read sessions.
FastAPI and uvicorn are imported only when the Server starts; a test keeps them out of the CLI's start.
Each request is logged at DEBUG, with its query decoded and any `token` in it hidden.
