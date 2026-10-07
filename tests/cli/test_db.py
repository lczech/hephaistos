import json
import re
import sqlite3

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

runner = CliRunner()

FULL_CLOCK = r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} #\d+"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


@pytest.fixture(autouse=True)
def set_up(paths: object) -> None:
    """A Machine with Repositories `one` and `two`."""
    del paths
    runner.invoke(app, ["setup", "--name", "laptop"])
    runner.invoke(app, ["repo", "add", "one"])
    runner.invoke(app, ["repo", "add", "two"])


def _stdout(*args: str) -> str:
    result = runner.invoke(app, ["db", *args])
    assert result.exit_code == 0, result.output
    return result.stdout


def test_tables() -> None:
    lines = _stdout("tables").splitlines()
    assert lines[0].split() == ["table", "category", "rows", "latest"]
    rows = {line.split()[0]: line.split(maxsplit=3)[1:] for line in lines[1:]}
    assert rows["meta"] == ["local", "3", "-"]
    category, count, latest = rows["registry_repositories"]
    assert (category, count) == ("registry", "2")
    assert re.fullmatch(FULL_CLOCK, latest)


def test_tables_as_json() -> None:
    found = json.loads(_stdout("tables", "--json"))
    assert found[0] == {"table": "meta", "category": "local", "rows": 3, "latest": None}
    assert re.fullmatch(r"\S+T\S+\.\d{3}\+00:00 #\d+", found[-1]["latest"])


def test_dump_all_columns_as_blocks() -> None:
    blocks = _stdout("dump", "registry_repositories").split("\n\n")
    assert len(blocks) == 2
    fields = dict(line.split(maxsplit=1) for line in blocks[0].splitlines())
    assert list(fields) == ["id", "name", "modified_at", "modified_by", "deleted"]
    assert fields["name"] == "two"
    assert re.fullmatch(UUID, fields["id"])
    assert re.fullmatch(FULL_CLOCK, fields["modified_at"])


def test_dump_chosen_columns_as_a_table() -> None:
    lines = _stdout("dump", "events", "-c", "kind", "-c", "subject", "--short-ids").splitlines()
    assert lines[0].split() == ["kind", "subject"]
    assert lines[1].split()[0] == "repository.added"
    assert re.fullmatch(r"[0-9a-f]{8}", lines[1].split()[1])
    blocks = _stdout("dump", "events", "-c", "kind", "--blocks")
    assert blocks.startswith("kind  repository.added\n\nkind  repository.added\n")
    assert _stdout("dump", "meta", "--table").splitlines()[0].split() == ["key", "value"]


def test_dump_limit_and_json() -> None:
    assert len(_stdout("dump", "events", "-c", "kind", "-n", "1").splitlines()) == 2
    found = json.loads(_stdout("dump", "events", "-n", "0", "--json"))
    assert [event["kind"] for event in found][:2] == ["repository.added", "repository.added"]
    assert found[0]["payload"]["name"] == "two"
    assert found[0]["occurred_at"] is None


def test_dump_empty_table() -> None:
    assert _stdout("dump", "state_worktrees") == "No rows\n"
    assert _stdout("dump", "state_worktrees", "-c", "name") == "No rows\n"


def test_dump_errors() -> None:
    result = runner.invoke(app, ["db", "dump", "events", "-c", "nope"])
    assert isinstance(result.exception, HephaistosError)
    assert str(result.exception).startswith("events has no column nope")


def test_outdated_database_gives_a_warning(paths: Paths) -> None:
    conn = sqlite3.connect(paths.database)
    with conn:
        conn.execute("UPDATE meta SET value = 'outdated' WHERE key = 'schema_hash'")
        conn.execute("CREATE TABLE old_things (note TEXT)")
    conn.close()
    result = runner.invoke(app, ["db", "tables"])
    assert result.exit_code == 0, result.output
    assert "warning: the database's schema is outdated" in result.stderr
    assert "warning: 1 table not in this version's schema: old_things" in result.stderr
    assert result.stdout.splitlines()[-1].split() == ["old_things", "unknown", "0", "-"]
