import json
import logging
import re
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from hephaistos.cli.main import app as cli
from hephaistos.core import config, serialize
from hephaistos.core.utils import logs
from hephaistos.core.utils.paths import Paths, short_path
from hephaistos.daemon.server import token
from hephaistos.daemon.server.app import create_app
from hephaistos.daemon.server.guard import Counts
from hephaistos.daemon.watcher.worker import PassFailed
from support import FakeWatcher, git
from support import clone as clone_of

VERSION = "0.1.0 (test)"

runner = CliRunner()


@pytest.fixture
def counts() -> Counts:
    return Counts()


@pytest.fixture
def watcher() -> FakeWatcher:
    return FakeWatcher()


@pytest.fixture
def client(paths: Paths, repo: Path, counts: Counts, watcher: FakeWatcher) -> TestClient:
    """A client of the Server for the Machine with Clone `repo`, with a Worktree `side`."""
    git(repo, "worktree", "add", "--quiet", "-b", "side", str(repo.parent / "side"))
    assert runner.invoke(cli, ["observe"]).exit_code == 0
    app = create_app(paths, counts, VERSION, watcher.observe, None)
    headers = {"Authorization": f"Bearer {token.token(paths)}"}
    return TestClient(app, base_url="http://localhost:8264", headers=headers)


def _cli(*args: str) -> Any:  # noqa: ANN401 - parsed JSON
    result = runner.invoke(cli, [*args, "--json"])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_info(client: TestClient) -> None:
    info = client.get("/api/info").json()
    assert info["version"] == VERSION
    major, minor = serialize.API_VERSION
    assert info["api"] == {"major": major, "minor": minor}
    assert info["machine"]["name"] == "laptop"
    assert info["home"] == str(Path.home())


def test_needs_the_token(
    client: TestClient, counts: Counts, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, "hephaistos.daemon.server")
    missing = client.get("/api/info", headers={"Authorization": ""})
    assert (missing.status_code, missing.json()) == (
        401,
        {"error": "no token; see `hephaistos daemon token`", "checkout": None},
    )
    assert missing.headers["www-authenticate"] == "Bearer"
    wrong = client.get("/api/info?x=1", headers={"Authorization": "Bearer nope"})
    assert (wrong.status_code, wrong.json()["error"]) == (
        401,
        "wrong token; see `hephaistos daemon token`",
    )
    foreign = client.get("/api/info", headers={"Host": "evil.example:8264"})
    assert (foreign.status_code, foreign.json()["error"]) == (
        400,
        "this server answers only to localhost, not to evil.example",
    )
    assert client.get("/api/info").status_code == 200
    assert (counts.refused, counts.requests) == (3, 1)
    assert counts.last_request_at is not None
    messages = [record.getMessage() for record in caplog.records]
    assert messages[:3] == [
        "refused GET /api/info from testclient: no token; see `hephaistos daemon token`",
        ("refused GET /api/info?x=1 from testclient: wrong token; see `hephaistos daemon token`"),
        (
            "refused GET /api/info from testclient:"
            " this server answers only to localhost, not to evil.example"
        ),
    ]
    assert re.fullmatch(r"GET /api/info 200 \d+ ms", messages[3])


def test_the_token_counts_only_in_the_header(
    paths: Paths, client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, "hephaistos.daemon.server")
    value = token.token(paths)
    browser = TestClient(client.app, base_url="http://localhost:8264")
    assert browser.get(f"/api/info?tab=x&%74oken={value}").status_code == 401
    assert browser.get("/api/info", headers={"Cookie": f"hephaistos={value}"}).status_code == 401
    assert client.get(f"/api/info?Token={value}").status_code == 200
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "GET /api/info?tab=x&token=… from testclient" in logged
    assert "GET /api/info?Token=… 200" in logged
    assert value not in logged


def test_endpoints_return_what_the_cli_prints(client: TestClient) -> None:
    def api(path: str) -> Any:  # noqa: ANN401 - parsed JSON
        response = client.get(path)
        assert response.status_code == 200, response.text
        return response.json()

    [machine] = _cli("machine", "list")
    assert api("/api/machines") == [machine]
    assert api(f"/api/machines/{machine['id']}") == _cli("machine", "show")
    [repository] = _cli("repo", "list")
    assert api("/api/repositories") == [repository]
    assert api(f"/api/repositories/{repository['id']}") == _cli("repo", "show", "proj")
    [clone] = _cli("clone", "list")
    assert api("/api/clones") == [clone]
    assert api(f"/api/clones?repository={repository['id']}") == [clone]
    assert api(f"/api/clones/{clone['id']}") == _cli("clone", "show", clone["path"])
    [worktree] = _cli("worktree", "list")
    assert worktree["name"] == "side"
    assert api("/api/worktrees") == [worktree]
    assert api(f"/api/worktrees/{worktree['id']}") == _cli("worktree", "show", "side")
    listed = _cli("event", "list", "-n", "0", "--reverse")
    assert api("/api/events?limit=0") == listed
    first = listed[0]
    assert api(f"/api/events/{first['id']}") == _cli("event", "show", first["id"])
    assert api("/api/events/kinds") == _cli("event", "kinds")
    assert api("/api/config") == _cli("config", "show")
    assert api("/api/db/tables") == _cli("db", "tables")
    rows = "/api/db/tables/events?column=kind&column=id&limit=2&offset=1"
    assert api(rows) == _cli(
        "db", "dump", "events", "-c", "kind", "-c", "id", "-n", "2", "--offset", "1", "--reverse"
    )


def test_log_as_log_show_prints_it(paths: Paths, client: TestClient) -> None:
    start = datetime.now(UTC) - timedelta(minutes=10)
    for minute in range(5):
        _write_record(paths, start + timedelta(minutes=minute), f"record {minute}")
    show = ["log", "show", "--reverse", "--json", "--no-pager"]
    lines = runner.invoke(cli, show).output.splitlines()
    shown = client.get("/api/log").json()
    assert shown == {"entries": [json.loads(line) for line in lines], "skipped": 0}
    pages = client.get("/api/log", params={"limit": 2}).json()["entries"]
    while len(pages) < 5:
        before = pages[-1]["position"]
        pages += client.get("/api/log", params={"limit": 2, "before": before}).json()["entries"]
    messages = [entry["record"]["message"] for entry in pages]
    assert messages == [f"record {minute}" for minute in reversed(range(5))]
    errors = client.get("/api/log", params={"level": "error", "process": "daemon"}).json()
    assert errors["entries"] == []


def _write_record(paths: Paths, at: datetime, message: str) -> None:
    record: logs.Record = {
        "at": at.isoformat(),
        "level": "INFO",
        "process": "cli",
        "pid": 7,
        "message": message,
    }
    with logs.day_file(paths.state_dir, at.date()).open("a") as file:
        file.write(logs.json_text(record) + "\n")


def test_config_says_what_it_applies(paths: Paths, client: TestClient) -> None:
    (paths.config_dir / "config.toml").write_text("[git]\ntimeout = 90\n")
    shown = client.get("/api/config").json()
    [timeout] = [setting for setting in shown["settings"] if setting["key"] == "git.timeout"]
    assert timeout == {
        "key": "git.timeout",
        "description": config.DESCRIPTIONS["git.timeout"],
        "type": "float",
        "value": 90.0,
        "source": str(paths.config_dir / "config.toml"),
        "applied": 30.0,  # loaded before the edit
    }
    assert shown["sources"][0] == {
        "source": str(paths.config_dir / "config.toml"),
        "kind": "file",
        "state": "read",
        "error": None,
    }


def test_events_filter_and_page_back(client: TestClient) -> None:
    every = client.get("/api/events", params={"limit": 0}).json()
    assert len(every) > 3
    pages = client.get("/api/events", params={"limit": 2}).json()
    while len(pages) < len(every):
        older = client.get("/api/events", params={"limit": 2, "before": pages[-1]["id"]}).json()
        assert older
        pages += older
    assert pages == every
    kinds = client.get("/api/events", params={"kind": ["clone", "worktree"], "since": "1h"})
    assert {event["subject"]["type"] for event in kinds.json()} == {"clone", "worktree"}


def test_events_of_several_repositories_and_machines(client: TestClient) -> None:
    every = client.get("/api/events", params={"limit": 0}).json()
    [repository] = client.get("/api/repositories").json()
    [machine] = client.get("/api/machines").json()
    nobody = "0199e000-0000-7000-8000-000000000000"
    about = [event for event in every if event["repository"] is not None]
    assert 0 < len(about) < len(every)
    by = {"limit": 0, "repository": [nobody, repository["id"]], "machine": [machine["id"], nobody]}
    assert client.get("/api/events", params=by).json() == about
    assert client.get("/api/events", params={"machine": nobody}).json() == []


@pytest.mark.parametrize(
    ("path", "status", "error"),
    [
        ("/api/nothing", 404, "Not Found"),
        ("/api/clones/{id}", 404, "no clone with ID {id}"),
        ("/api/machines/{id}", 404, "no machine with ID {id}"),
        ("/api/events/{id}", 404, "no event with ID {id}"),
        ("/api/events?before={id}", 400, "no event with ID {id}"),
        ("/api/events?since=soon", 400, "since: 'soon' is neither a duration like 2h"),
        ("/api/clones/xyz", 400, "path clone_id: Input should be a valid UUID"),
        ("/api/events?priority=top", 400, "query priority: Input should be 'low'"),
        ("/api/db/tables/nope", 404, "no table nope; `hephaistos db tables` lists them"),
        ("/api/db/tables/events?column=nope", 400, "events has no column nope"),
        ("/api/log?until=soon", 400, "until: 'soon' is neither a duration like 2h"),
        ("/api/log?before=yesterday", 400, "before: 'yesterday' is not a position like"),
        ("/api/changes", 400, "give either clone or worktree"),
        ("/api/changes?clone={id}", 404, "no clone with ID {id}"),
        ("/api/changes?worktree={id}", 404, "no worktree with ID {id}"),
        ("/api/diff?clone={id}&from=HEAD&to=index", 400, "query path: Field required"),
        ("/api/diff/files?clone={id}&from=HEAD&to=index&path=a", 404, "no clone with ID {id}"),
        ("/api/history?clone={id}", 404, "no clone with ID {id}"),
        ("/api/history?limit=0", 400, "query limit: Input should be greater than or equal to 1"),
    ],
)
def test_errors(client: TestClient, path: str, status: int, error: str) -> None:
    some_id = str(uuid.uuid4())
    response = client.get(path.format(id=some_id))
    assert response.status_code == status
    assert response.json()["error"].startswith(error.format(id=some_id))


def test_changes_of_a_clone_and_a_worktree(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    [worktree] = _cli("worktree", "list")
    (repo / "new.txt").write_text("one\ntwo\n")
    (repo.parent / "side" / "other.txt").write_text("x\n")
    found = client.get("/api/changes", params={"clone": clone["id"]}).json()
    assert found["branch"]["branch"] == "main"
    assert found["groups"] == [
        {
            "name": "untracked",
            "from": "index",
            "to": "working-tree",
            "count": 1,
            "changes": [
                {
                    "path": "new.txt",
                    "status": "?",
                    "original": None,
                    "added": 2,
                    "removed": 0,
                    "binary": False,
                    "size": None,
                    "old_size": None,
                    "files": None,
                    "more_files": False,
                }
            ],
        }
    ]
    side = client.get("/api/changes", params={"worktree": worktree["id"]}).json()
    assert [change["path"] for change in side["groups"][0]["changes"]] == ["other.txt"]
    compared = {"clone": clone["id"], "from": "HEAD", "to": "HEAD"}
    assert client.get("/api/changes", params=compared).json() == {
        "branch": None,
        "groups": [],
        "commit": None,
    }


def test_changes_refused(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    nope = client.get("/api/changes", params={"clone": clone["id"], "from": "nope", "to": "HEAD"})
    assert (nope.status_code, nope.json()["error"]) == (
        400,
        "'nope' is neither index, working-tree nor a commit here",
    )
    outside = client.get("/api/changes", params={"clone": clone["id"], "path": "../x"})
    assert outside.status_code == 400
    shutil.rmtree(repo)
    missing = client.get("/api/changes", params={"clone": clone["id"]})
    assert (missing.status_code, missing.json()) == (
        404,
        {
            "error": f"the clone at {short_path(repo)} is missing: nothing is at its path",
            "checkout": {"clone": clone["id"], "worktree": None, "gone": None},
        },
    )


def test_gone_checkouts_say_what_happened(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    [worktree] = _cli("worktree", "list")
    side = short_path(repo.parent / "side")
    git(repo, "worktree", "remove", str(repo.parent / "side"))
    assert runner.invoke(cli, ["observe"]).exit_code == 0
    removed = client.get("/api/history", params={"worktree": worktree["id"]})
    assert (removed.status_code, removed.json()) == (
        410,
        {
            "error": f"the worktree at {side} was removed",
            "checkout": {"clone": clone["id"], "worktree": worktree["id"], "gone": "worktree"},
        },
    )
    assert client.get(f"/api/worktrees/{worktree['id']}").status_code == 410
    assert runner.invoke(cli, ["clone", "unregister", str(repo)]).exit_code == 0
    unregistered = client.get("/api/changes", params={"clone": clone["id"]})
    assert (unregistered.status_code, unregistered.json()) == (
        410,
        {
            "error": f"the clone at {short_path(repo)} was unregistered; its files are untouched",
            "checkout": {"clone": clone["id"], "worktree": None, "gone": "clone"},
        },
    )
    assert client.get(f"/api/clones/{clone['id']}").status_code == 410
    of_clone = client.get("/api/changes", params={"worktree": worktree["id"]})
    assert (of_clone.status_code, of_clone.json()["checkout"]["gone"]) == (410, "clone")
    assert of_clone.json()["error"].startswith(f"the clone of the worktree at {side} was")


def test_diff_of_a_file(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    (repo / "new.txt").write_text("one\ntwo\n")
    asked = {"clone": clone["id"], "from": "index", "to": "working-tree", "path": "new.txt"}
    found = client.get("/api/diff", params=asked).json()
    assert (found["change"]["status"], found["change"]["added"]) == ("?", 2)
    assert found["patch"].startswith("diff --git a/new.txt b/new.txt\n")
    assert found["patch"].endswith("@@ -0,0 +1,2 @@\n+one\n+two\n")
    files = client.get("/api/diff/files", params=asked).json()
    assert files == {"old": None, "new": "one\ntwo\n"}
    unchanged = client.get("/api/diff", params={**asked, "from": "HEAD", "to": "index"}).json()
    assert unchanged == {"change": None, "patch": None}
    folder = client.get("/api/diff", params={**asked, "path": "src/"})
    assert (folder.status_code, folder.json()["error"]) == (
        400,
        "a diff is of a file, not of the folder src/",
    )
    git(repo, "add", "new.txt")
    (repo / "new.txt").write_text("one\n2\n")
    for context, hunk in ((0, "@@ -2 +2 @@"), (3, "@@ -1,2 +1,2 @@")):
        patch = client.get("/api/diff", params={**asked, "context": context}).json()["patch"]
        assert hunk in patch
    assert client.get("/api/diff", params={**asked, "context": -1}).status_code == 400


def test_diffs_of_a_comparison(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    for name in ("a.txt", "b.txt"):
        (repo / name).write_text(f"{name}\n")
    git(repo, "add", "a.txt", "b.txt")
    (repo / "notes.md").write_text("untracked\n")  # left out
    asked = {"clone": clone["id"], "from": "HEAD", "to": "working-tree"}
    found = client.get("/api/diffs", params={**asked, "new": True}).json()
    each = [
        client.get("/api/diff", params={**asked, "path": name}).json()
        for name in ("a.txt", "b.txt")
    ]
    assert found == {"diffs": each, "new": {"a.txt": "a.txt\n", "b.txt": "b.txt\n"}, "next": None}
    rest = client.get("/api/diffs", params={**asked, "skip": 1}).json()
    assert rest == {"diffs": each[1:], "new": None, "next": None}


def _commit(repo: Path, message: str, *args: str) -> str:
    git(repo, "commit", "--quiet", "--allow-empty", "--message", message, *args)
    return git(repo, "rev-parse", "HEAD")


def test_history_in_pages_with_the_refs(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    head = _commit(repo, "second", "--message", "With a body.")
    first = client.get("/api/history", params={"clone": clone["id"], "limit": 1}).json()
    assert (first["head"], first["branch"]) == (head, "main")
    assert [(ref["kind"], ref["name"]) for ref in first["refs"]] == [
        ("branch", "main"),
        ("branch", "side"),
        ("remote", "origin/main"),
    ]
    [commit] = first["commits"]
    assert (commit["hash"], commit["subject"], commit["body"]) == (head, "second", "With a body.")
    assert commit["author"]["name"] == "Test"
    assert commit["refs"] == [
        {"name": "main", "full": "refs/heads/main", "kind": "branch", "commit": head}
    ]
    assert first["next"] == {"start": head, "path": None, "skip": 1}
    after = {key: value for key, value in first["next"].items() if value is not None}
    rest = client.get("/api/history", params={"clone": clone["id"], **after}).json()
    assert [commit["parents"] for commit in rest["commits"]] == [[]]
    assert rest["next"] is None
    found = client.get("/api/history", params={"clone": clone["id"], "search": "BODY with"})
    assert [commit["hash"] for commit in found.json()["commits"]] == [head]
    assert found.json()["found"] is None
    # A hash, on another branch: found, with the branch leading to it.
    git(repo, "switch", "--quiet", "--create", "other", "HEAD~1")
    aside = _commit(repo, "aside")
    git(repo, "switch", "--quiet", "main")
    named = client.get("/api/history", params={"clone": clone["id"], "search": aside[:7]}).json()
    assert named["commits"] == []
    assert (named["found"]["commit"]["hash"], named["found"]["where"]) == (aside, "refs")
    assert [ref["name"] for ref in named["found"]["refs"]] == ["other"]
    asked = {"clone": clone["id"], "everywhere": True, "limit": 1}
    everywhere = client.get("/api/history", params=asked).json()
    assert everywhere["next"] == {"start": None, "path": None, "skip": 1}
    rest = client.get("/api/history", params={**asked, "skip": 1}).json()
    newest = [commit["hash"] for commit in everywhere["commits"] + rest["commits"]]
    assert sorted(newest) == sorted([aside, head])  # by date: in either order within a second
    refused = client.get("/api/history", params={"clone": clone["id"], "skip": 1})
    assert (refused.status_code, refused.json()["error"]) == (
        400,
        "give start to go on, unless everywhere",
    )
    gone = client.get("/api/history", params={"clone": clone["id"], "ref": "gone"})
    assert (gone.status_code, gone.json()["error"]) == (
        400,
        "'gone' is not a branch, tag or commit here",
    )


def test_a_commits_changes_and_diff(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    (repo / "new.txt").write_text("one\n")
    git(repo, "add", "new.txt")
    head = _commit(repo, "add new")
    asked = {"clone": clone["id"], "commit": head[:7]}
    found = client.get("/api/changes", params=asked).json()
    assert found["commit"]["name"] == head[:7]
    assert (found["commit"]["commit"]["hash"], found["commit"]["reachable"]) == (head, True)
    assert found["commit"]["amended_as"] is None
    [group] = found["groups"]
    assert (group["from"], group["to"]) == (git(repo, "rev-parse", "HEAD~1"), head)
    assert [change["path"] for change in group["changes"]] == ["new.txt"]
    diff = client.get("/api/diff", params={**asked, "path": "new.txt"}).json()
    assert diff["patch"].endswith("@@ -0,0 +1 @@\n+one\n")
    files = client.get("/api/diff/files", params={**asked, "path": "new.txt"}).json()
    assert files == {"old": None, "new": "one\n"}
    both = client.get("/api/diff", params={**asked, "path": "new.txt", "from": "HEAD"})
    assert (both.status_code, both.json()["error"]) == (
        400,
        "give commit, or from and to, not both",
    )
    neither = client.get("/api/diff", params={"clone": clone["id"], "path": "new.txt"})
    assert (neither.status_code, neither.json()["error"]) == (400, "give from and to, or commit")


def test_a_commit_amended_away(client: TestClient, repo: Path) -> None:
    [clone] = _cli("clone", "list")
    old = _commit(repo, "first try")
    new = _commit(repo, "second try", "--amend")
    assert runner.invoke(cli, ["observe"]).exit_code == 0
    found = client.get("/api/changes", params={"clone": clone["id"], "commit": old}).json()
    assert found["commit"]["commit"]["subject"] == "first try"  # the reflog keeps it
    assert (found["commit"]["reachable"], found["commit"]["amended_as"]) == (False, new)
    git(repo, "reflog", "expire", "--expire-unreachable=now", "--all")
    git(repo, "gc", "--quiet", "--prune=now")
    found = client.get("/api/changes", params={"clone": clone["id"], "commit": old}).json()
    assert found == {
        "branch": None,
        "groups": [],
        "commit": {"name": old, "commit": None, "reachable": False, "amended_as": new},
    }


def test_a_bare_clone_has_history_and_commits(
    client: TestClient, repo: Path, tmp_path: Path
) -> None:
    bare = clone_of(repo, tmp_path / "bare.git", bare=True)
    assert runner.invoke(cli, ["clone", "register", str(bare), "--repo", "proj"]).exit_code == 0
    found = next(found for found in _cli("clone", "list") if found["path"].endswith("bare.git"))
    history = client.get("/api/history", params={"clone": found["id"]}).json()
    assert len(history["commits"]) == 1
    head = history["commits"][0]["hash"]
    commit = client.get("/api/changes", params={"clone": found["id"], "commit": head})
    assert commit.json()["commit"]["reachable"]
    status = client.get("/api/changes", params={"clone": found["id"]})
    assert (status.status_code, status.json()["error"]) == (
        400,
        f"{found['path']} is bare: no working tree",
    )


def test_an_unexpected_error_is_logged_not_shown(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(*_: object) -> None:
        raise KeyError("branch")

    monkeypatch.setattr(serialize, "machines_json", broken)
    response = client.get("/api/machines")
    assert (response.status_code, response.json()) == (
        500,
        {"error": "internal error; see the log on laptop", "checkout": None},
    )
    [record] = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert record.getMessage() == "failed: GET /api/machines"
    assert record.exc_info is not None


def test_observe_has_the_watcher_pass(client: TestClient, watcher: FakeWatcher) -> None:
    observed = client.post("/api/observe")
    assert (observed.status_code, observed.content) == (204, b"")
    watcher.outcome = PassFailed("the database is busy")
    failed = client.post("/api/observe")
    assert (failed.status_code, failed.json()) == (
        503,
        {"error": "the pass failed: the database is busy", "checkout": None},
    )
    assert watcher.triggers == ["api", "api"]
    assert client.get("/api/observe").status_code == 405


def test_daemon_is_what_status_prints(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl
    result = runner.invoke(cli, ["daemon", "status", "--json"])
    assert result.exit_code == 3  # not running
    assert client.get("/api/daemon").json() == json.loads(result.output)


def test_no_docs_but_the_schema_with_the_token(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/openapi.json", headers={"Authorization": ""}).status_code == 401
