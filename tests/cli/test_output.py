from datetime import datetime, timedelta

import pytest

from hephaistos.cli.output import relative_time, short_time, time_formatter
from hephaistos.core.config import TimeFormat
from hephaistos.core.utils.paths import Paths

NOW = datetime(2026, 10, 5, 14, 3, 21).astimezone()


@pytest.mark.parametrize(
    ("ago", "shown"),
    [
        (timedelta(seconds=-30), "now"),
        (timedelta(seconds=59), "now"),
        (timedelta(minutes=1), "1m"),
        (timedelta(minutes=59, seconds=59), "59m"),
        (timedelta(hours=1), "1h"),
        (timedelta(hours=23, minutes=59), "23h"),
        (timedelta(days=1), "1d"),
        (timedelta(days=400), "400d"),
    ],
)
def test_relative_time(ago: timedelta, shown: str) -> None:
    assert relative_time(NOW - ago, NOW) == shown


@pytest.mark.parametrize(
    ("value", "shown"),
    [
        (datetime(2026, 10, 5, 9, 15).astimezone(), "09:15"),
        (datetime(2026, 3, 2, 8, 0).astimezone(), "03-02 08:00"),
        (datetime(2025, 12, 31, 23, 0).astimezone(), "2025-12-31"),
    ],
)
def test_short_time(value: datetime, shown: str) -> None:
    assert short_time(value, NOW) == shown


def test_time_format_from_option_then_config_then_default(paths: Paths) -> None:
    value = NOW - timedelta(hours=2)
    assert time_formatter(None, TimeFormat.RELATIVE, NOW)(value) == "2h"
    assert time_formatter(TimeFormat.SHORT, TimeFormat.RELATIVE, NOW)(value) == "12:03"

    paths.config_file.parent.mkdir(parents=True)
    paths.config_file.write_text('time_format = "full"\n')
    assert time_formatter(None, TimeFormat.RELATIVE, NOW)(value) == "2026-10-05 12:03:21"
    assert time_formatter(TimeFormat.RELATIVE, TimeFormat.FULL, NOW)(value) == "2h"
