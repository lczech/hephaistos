import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from hephaistos.cli.main import app as cli
from hephaistos.core import views
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.server import token
from hephaistos.daemon.server.app import COOKIE, Counts, create_app
from support import git

VERSION = "0.1.0 (test)"

runner = CliRunner()


@pytest.fixture
def counts() -> Counts:
    return Counts()


@pytest.fixture
def client(paths: Paths, repo: Path, counts: Counts) -> TestClient:
    """A client of the Server for the Machine with Clone `repo`, with a Worktree `side`."""
    git(repo, "worktree", "add", "--quiet", "-b", "side", str(repo.parent / "side"))
    assert runner.invoke(cli, ["observe"]).exit_code == 0
    app = create_app(paths, counts, VERSION)
    headers = {"Authorization": f"Bearer {token.token(paths)}"}
    return TestClient(app, base_url="http://localhost:8264", headers=headers)


def _cli(*args: str) -> Any:  # noqa: ANN401 - parsed JSON
    result = runner.invoke(cli, [*args, "--json"])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_info(client: TestClient) -> None:
    info = client.get("/api/info").json()
    assert info["version"] == VERSION
    assert info["api"] == {"major": views.API_VERSION.major, "minor": views.API_VERSION.minor}
    assert info["machine"]["name"] == "laptop"


def test_needs_the_token(
    client: TestClient, counts: Counts, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, "hephaistos.daemon.server")
    missing = client.get("/api/info", headers={"Authorization": ""})
    assert (missing.status_code, missing.json()) == (
        401,
        {"error": "no token; see `hephaistos daemon token`"},
    )
    assert missing.headers["www-authenticate"] == "Bearer"
    wrong = client.get("/api/info?x=1&token=nope")
    assert (wrong.status_code, wrong.json()["error"]) == (
        401,
        "wrong token; see `hephaistos daemon token`",
    )
    foreign = client.get("/api/info", headers={"Host": "evil.example:8264"})
    assert (foreign.status_code, foreign.json()["error"]) == (
        400,
        "this Server answers only to localhost, not to evil.example",
    )
    assert client.get("/api/info").status_code == 200
    assert (counts.refused, counts.requests) == (3, 1)
    assert counts.last_request_at is not None
    messages = [record.getMessage() for record in caplog.records]
    assert messages[:3] == [
        "refused GET /api/info from testclient: no token; see `hephaistos daemon token`",
        (
            "refused GET /api/info?x=1&token=… from testclient:"
            " wrong token; see `hephaistos daemon token`"
        ),
        (
            "refused GET /api/info from testclient:"
            " this Server answers only to localhost, not to evil.example"
        ),
    ]
    assert re.fullmatch(r"GET /api/info 200 \d+ ms", messages[3])


def test_a_url_with_the_token_logs_a_browser_in(paths: Paths, client: TestClient) -> None:
    browser = TestClient(client.app, base_url="http://localhost:8264")
    assert browser.get("/").status_code == 401
    value = token.token(paths)
    login = browser.get(f"/?token={value}&tab=events", follow_redirects=False)
    assert (login.status_code, login.headers["location"]) == (303, "/?tab=events")
    cookie = login.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}={value};")
    for attribute in ("HttpOnly", "Max-Age=31536000", "Path=/", "SameSite=strict"):
        assert attribute in cookie
    assert browser.get("/").json() == {"hephaistos": VERSION, "gui": "not yet"}
    token.renew(paths)
    assert browser.get("/").status_code == 401


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
    listed = _cli("event", "list", "-n", "0")
    assert api("/api/events?limit=0") == listed
    first = listed[0]
    assert api(f"/api/events/{first['id']}") == _cli("event", "show", first["id"])


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


@pytest.mark.parametrize(
    ("path", "status", "error"),
    [
        ("/api/nothing", 404, "Not Found"),
        ("/api/clones/{id}", 404, "no Clone with ID {id}"),
        ("/api/machines/{id}", 404, "no Machine with ID {id}"),
        ("/api/events/{id}", 404, "no Event with ID {id}"),
        ("/api/events?before={id}", 400, "no Event with ID {id}"),
        ("/api/events?since=soon", 400, "since: 'soon' is neither a duration like 2h"),
        ("/api/clones/xyz", 400, "path clone_id: Input should be a valid UUID"),
        ("/api/events?priority=top", 400, "query priority: Input should be 'low'"),
    ],
)
def test_errors(client: TestClient, path: str, status: int, error: str) -> None:
    some_id = str(uuid.uuid4())
    response = client.get(path.format(id=some_id))
    assert response.status_code == status
    assert response.json()["error"].startswith(error.format(id=some_id))


def test_an_unexpected_error_is_logged_not_shown(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(*_: object) -> None:
        raise KeyError("branch")

    monkeypatch.setattr(views, "machines_json", broken)
    response = client.get("/api/machines")
    assert (response.status_code, response.json()) == (
        500,
        {"error": "internal error; see the log on laptop"},
    )
    [record] = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert record.getMessage() == "failed: GET /api/machines"
    assert record.exc_info is not None


def test_daemon_is_what_status_prints(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl
    result = runner.invoke(cli, ["daemon", "status", "--json"])
    assert result.exit_code == 3  # not running
    assert client.get("/api/daemon").json() == json.loads(result.output)


def test_docs_need_the_token(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json", headers={"Authorization": ""}).status_code == 401
