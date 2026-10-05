from pathlib import Path

import pytest

from hephaistos.core.config import Config, ConfigError, TimeFormat, load


def test_missing_file_gives_defaults(tmp_path: Path) -> None:
    assert load(tmp_path / "config.toml") == Config()


def test_time_format(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('time_format = "short"\n')
    assert load(path).time_format is TimeFormat.SHORT


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('time_fromat = "short"\n', "unknown settings: time_fromat"),
        ('time_format = "long"\n', "must be one of relative, short, full"),
        ("time_format = 3\n", "must be one of"),
        ("time_format = \n", "cannot read"),
    ],
)
def test_invalid(tmp_path: Path, text: str, message: str) -> None:
    path = tmp_path / "config.toml"
    path.write_text(text)
    with pytest.raises(ConfigError, match=message):
        load(path)


SECTIONS = """
time_format = "short"

[machines.login01]
time_format = "full"

[machines."login01.cluster.example.org"]
time_format = "relative"

[machines.laptop]
"""


@pytest.mark.parametrize(
    ("hostname", "expected"),
    [
        ("desktop", TimeFormat.SHORT),
        ("laptop", TimeFormat.SHORT),
        ("login01", TimeFormat.FULL),
        ("login01.other.org", TimeFormat.FULL),
        ("login01.cluster.example.org", TimeFormat.RELATIVE),
    ],
)
def test_machine_sections_override(tmp_path: Path, hostname: str, expected: TimeFormat) -> None:
    path = tmp_path / "config.toml"
    path.write_text(SECTIONS)
    assert load(path, hostname).time_format is expected


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('[machines.other]\ntime_fromat = "full"\n', r"unknown settings in \[machines.other\]"),
        ('[machines.other]\ntime_format = "long"\n', r"time_format in \[machines.other\]"),
        ('machines = "laptop"\n', "one section per hostname"),
        ('[machines]\nlaptop = "full"\n', "one section per hostname"),
    ],
)
def test_invalid_sections(tmp_path: Path, text: str, message: str) -> None:
    path = tmp_path / "config.toml"
    path.write_text(text)
    with pytest.raises(ConfigError, match=message):
        load(path, "laptop")
