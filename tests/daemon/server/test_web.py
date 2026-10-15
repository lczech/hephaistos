from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.server import token, web
from hephaistos.daemon.server.app import create_app
from hephaistos.daemon.server.guard import Counts
from support import FakeWatcher

PAGE = "<!doctype html><script type=module src=/assets/index-3f9a.js></script>"


@pytest.fixture(autouse=True)
def laptop(paths: Paths) -> None:
    machines.set_up(paths, "laptop")


def _browser(paths: Paths, gui: Path | None) -> TestClient:
    """A browser without the token, at a Server whose GUI is built into `gui`."""
    app = create_app(paths, Counts(), "0.1.0", FakeWatcher().observe, gui)
    return TestClient(app, base_url="http://127.0.0.1:8264")


@pytest.fixture
def built(tmp_path: Path) -> Path:
    """A built GUI, next to a file that isn't part of it."""
    (tmp_path / "secret.txt").write_text("not for browsers")
    gui = tmp_path / "dist"
    (gui / "assets").mkdir(parents=True)
    (gui / "index.html").write_text(PAGE)
    (gui / "assets" / "index-3f9a.js").write_text("console.log('hi')")
    (gui / "assets" / "outside.txt").symlink_to(tmp_path / "secret.txt")
    (gui / "assets" / "icon-77c1.svg").write_text("<svg/>")
    return gui


def test_serves_the_gui_without_the_token(paths: Paths, built: Path) -> None:
    browser = _browser(paths, built)
    page = browser.get("/")
    assert (page.status_code, page.text) == (200, PAGE)
    assert page.headers["cache-control"] == "no-cache"
    assert page.headers["content-security-policy"] == web.POLICY
    assert page.headers["referrer-policy"] == "no-referrer"
    assert page.headers["x-content-type-options"] == "nosniff"
    script = browser.get("/assets/index-3f9a.js")
    assert (script.status_code, script.text) == (200, "console.log('hi')")
    assert script.headers["content-type"].startswith("text/javascript")
    assert script.headers["cache-control"] == "public, max-age=31536000, immutable"
    icon = browser.get("/assets/icon-77c1.svg")
    assert (icon.status_code, icon.headers["content-type"]) == (200, "image/svg+xml")


def test_the_api_still_needs_the_token(paths: Paths, built: Path) -> None:
    browser = _browser(paths, built)
    for path in (
        "/api/info",
        "/api",
        "/openapi.json",
        "/index.html",
        "/favicon.svg",
        "/secret.txt",
    ):
        refused = browser.get(path)
        assert refused.status_code == 401, path
        assert refused.headers["content-security-policy"] == web.POLICY
    foreign = browser.get("/", headers={"Host": "evil.example:8264"})
    assert foreign.status_code == 400


def test_serves_only_the_build(paths: Paths, built: Path) -> None:
    browser = _browser(paths, built)
    browser.headers["Authorization"] = f"Bearer {token.token(paths)}"
    for path in (
        "/assets/%2e%2e/%2e%2e/secret.txt",
        "/assets/outside.txt",
        "/assets/missing.js",
        "/index.html",
        "/secret.txt",
    ):
        missing = browser.get(path)
        assert missing.status_code == 404, path
        assert "error" in missing.json()


def test_says_how_to_build_it(paths: Paths, tmp_path: Path) -> None:
    gui = tmp_path / "gui" / "web" / "dist"
    page = _browser(paths, gui).get("/")
    assert page.status_code == 503
    assert (
        f"<code>cd {tmp_path} &amp;&amp; uv run npm --prefix gui/web ci &amp;&amp;"
        " uv run npm --prefix gui/web run build</code>"
    ) in page.text
    assert page.headers["content-security-policy"] == web.POLICY
    outside = _browser(paths, None).get("/")
    assert outside.status_code == 503
    assert "doesn't run from a checkout" in outside.text
    assert _browser(paths, None).get("/assets/index-3f9a.js").status_code == 404


def test_finds_the_build_in_its_checkout() -> None:
    assert web.build() == Path(__file__).parents[3] / "gui" / "web" / "dist"
