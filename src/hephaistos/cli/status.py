"""`hephaistos status`: the setup, the Daemon and what runs, as the Status View shows them."""

import os
from collections.abc import Sequence
from datetime import UTC, datetime

import typer

from hephaistos.cli.daemon import status_fields, when_formatter
from hephaistos.cli.output import JsonOption, TimeFormatOption, print_fields, print_json
from hephaistos.core.utils.paths import Paths
from hephaistos.core.utils.text import number_text
from hephaistos.daemon import checks, report
from hephaistos.daemon.about import AboutJson, about
from hephaistos.daemon.status import Check

INDENT = "  "


def _check_lines(found: Sequence[Check]) -> list[list[str]]:
    return [
        [check.name, check.outcome, check.text + ("" if check.fix is None else f"; {check.fix}")]
        for check in found
    ]


def _print_checks(found: Sequence[Check]) -> None:
    rows = _check_lines(found)
    widths = [max(len(row[column]) for row in rows) for column in range(2)]
    for name, outcome, text in rows:
        typer.echo(f"{INDENT}{name:<{widths[0]}}  {outcome:<{widths[1]}}  {text}")


def _about_fields(found: AboutJson) -> list[tuple[str, str]]:
    def known(value: str | None) -> str:
        return "unknown" if value is None else value

    return [
        ("hephaistos", found["version"]),
        ("API", found["api"]),
        ("Schema", str(found["schema"])),
        ("Python", found["python"]),
        ("SQLite", found["sqlite"]),
        ("git", known(found["git"])),
        ("systemd", known(found["systemd"])),
        ("OS", known(found["os"])),
        ("Kernel", found["kernel"]),
        ("Desktop", known(found["desktop"])),
        ("Locale", known(found["locale"])),
        ("Time zone", known(found["time_zone"])),
    ]


def _log_text(counts: report.LogCountsJson) -> str:
    hours = round(report.RECENT_LOG.total_seconds() / 3600)
    if not counts["errors"] and not counts["warnings"]:
        return f"no errors or warnings in the last {hours} h"
    errors = number_text(counts["errors"], "error")
    warnings = number_text(counts["warnings"], "warning")
    return (
        f"{errors} and {warnings} in the last {hours} h;"
        f" `hephaistos log show --level warning --since {hours}h`"
    )


def status(time_format: TimeFormatOption = None, *, as_json: JsonOption = False) -> None:
    """Check this machine's setup, and show the daemon and what runs, e.g. for an issue.

    The checks run here, with this shell's PATH; the daemon's, as it ran them last, are listed
    where they differ, as its PATH may.
    """
    paths = Paths.from_environment()
    found = checks.run(os.environ)
    now = datetime.now(UTC)
    daemon = report.report(paths)
    shown = report.status_json(paths, found, about(), daemon, now)
    if as_json:
        print_json(shown)
        return
    typer.echo("Setup, checked in this shell:")
    _print_checks(found)
    current = daemon.current
    when = when_formatter(time_format, now)
    if current is not None and current.checks is not None:
        recorded = current.checks
        others = [c for c in recorded.checks if c.outcome != "ok" and c not in found]
        heading = f"The daemon's, checked {when(recorded.at)}:"
        typer.echo(heading if others else f"{heading} nothing else")
        if others:
            _print_checks(others)
    typer.echo("Running:")
    print_fields(status_fields(daemon, now, when), INDENT)
    typer.echo("About:")
    print_fields(_about_fields(shown["about"]), INDENT)
    typer.echo(f"Log: {_log_text(shown['log'])}")
