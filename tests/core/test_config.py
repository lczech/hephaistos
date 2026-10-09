import dataclasses
import tomllib
from importlib.resources import files
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.config import DEFAULTS, ConfigError, LogLevel, TimeFormat, load


def test_defaults_file_sets_every_setting() -> None:
    def keys(table: dict[str, object], prefix: str = "") -> list[str]:
        found: list[str] = []
        for name, value in table.items():
            if isinstance(value, dict):
                found += keys(value, f"{prefix}{name}.")  # pyright: ignore[reportUnknownArgumentType]
            else:
                found.append(prefix + name)
        return found

    shipped = tomllib.loads(files("hephaistos.core").joinpath("defaults.toml").read_text())
    assert sorted(keys(shipped)) == sorted(config.KEYS)


def test_no_files_give_defaults(tmp_path: Path) -> None:
    loaded = load(tmp_path, "laptop", {})
    assert loaded.settings == DEFAULTS
    assert set(loaded.sources.values()) == {config.DEFAULT}
    assert DEFAULTS.time_format is TimeFormat.AUTO
    assert DEFAULTS.git.timeout == 30.0


def test_layers_override_key_by_key(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text(
        'time_format = "short"\n[git]\ntimeout = 60\n[log]\nlevel = "debug"\n'
    )
    (tmp_path / "config.login1.toml").write_text('time_format = "full"\n[git]\ntimeout = 90\n')
    (tmp_path / "config.login1.hpc.example.org.toml").write_text("[git]\ntimeout = 120.5\n")
    (tmp_path / "config.login2.toml").write_text("[git]\ntimeout = 1\n")
    env = {"HEPHAISTOS_LOG_LEVEL": "warning", "HEPHAISTOS_SCAN_DEPTH": ""}

    loaded = load(tmp_path, "login1.hpc.example.org", env)
    assert loaded.settings.time_format is TimeFormat.FULL
    assert loaded.settings.git.timeout == 120.5
    assert loaded.settings.log.level is LogLevel.WARNING
    assert loaded.settings.log.retention_days == 30
    assert loaded.settings.scan.depth == 3  # an empty variable is as if unset
    assert loaded.sources == {
        "time_format": str(tmp_path / "config.login1.toml"),
        "log.level": "HEPHAISTOS_LOG_LEVEL",
        "log.retention_days": config.DEFAULT,
        "git.timeout": str(tmp_path / "config.login1.hpc.example.org.toml"),
        "observe.workers": config.DEFAULT,
        "scan.depth": config.DEFAULT,
    }
    assert load(tmp_path, "login1", {}).settings.git.timeout == 90.0
    assert load(tmp_path, "laptop", {}).settings.git.timeout == 60.0


def test_files_for() -> None:
    names = [path.name for path in config.files_for(Path(), "login1.hpc.example.org")]
    assert names == ["config.toml", "config.login1.toml", "config.login1.hpc.example.org.toml"]
    assert [path.name for path in config.files_for(Path(), "laptop")] == [
        "config.toml",
        "config.laptop.toml",
    ]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('time_fromat = "short"\n', r"unknown setting time_fromat \(did you mean time_format\?\)"),
        ("[git]\ntimout = 3\n", r"unknown setting git.timout \(did you mean git.timeout\?\)"),
        ("[machines.laptop]\n", "unknown setting machines$"),
        (
            'time_format = "long"\n',
            'time_format must be one of auto, relative, short, full, not "long"',
        ),
        ('[git]\ntimeout = "1m"\n', 'git.timeout must be a number, not "1m"'),
        ("[git]\ntimeout = 0\n", "git.timeout must be more than 0, not 0.0"),
        ("[observe]\nworkers = 0\n", "observe.workers must be at least 1, not 0"),
        ("[observe]\nworkers = 2.5\n", "observe.workers must be an integer, not 2.5"),
        ("[scan]\ndepth = true\n", "scan.depth must be an integer, not true"),
        ('git = "fast"\n', r"git must be a section \[git\]"),
        ("time_format = \n", "cannot read"),
    ],
)
def test_invalid_files(tmp_path: Path, text: str, message: str) -> None:
    path = tmp_path / "config.laptop.toml"
    path.write_text(text)
    with pytest.raises(ConfigError, match=message) as info:
        load(tmp_path, "laptop", {})
    assert str(path) in str(info.value)


@pytest.mark.parametrize(
    ("variable", "value", "message"),
    [
        ("HEPHAISTOS_GIT_TIMEOUT", "1m", 'HEPHAISTOS_GIT_TIMEOUT: must be a number, not "1m"'),
        ("HEPHAISTOS_SCAN_DEPTH", "-1", "HEPHAISTOS_SCAN_DEPTH: must be at least 0, not -1"),
        ("HEPHAISTOS_LOG_LEVEL", "loud", "HEPHAISTOS_LOG_LEVEL: must be one of debug, info"),
    ],
)
def test_invalid_variables(tmp_path: Path, variable: str, value: str, message: str) -> None:
    with pytest.raises(ConfigError, match=f"^{message}"):
        load(tmp_path, "laptop", {variable: value})


def test_variables_are_converted(tmp_path: Path) -> None:
    env = {"HEPHAISTOS_GIT_TIMEOUT": "5", "HEPHAISTOS_OBSERVE_WORKERS": "2"}
    settings = load(tmp_path, "laptop", env).settings
    assert (settings.git.timeout, settings.observe.workers) == (5.0, 2)
    assert config.variable("log.retention_days") == "HEPHAISTOS_LOG_RETENTION_DAYS"


def test_activate() -> None:
    assert config.settings() is DEFAULTS
    chosen = dataclasses.replace(DEFAULTS, scan=config.Scan(depth=1))
    config.activate(chosen)
    assert config.settings() is chosen


def test_log_level_numbers() -> None:
    assert [level.number for level in LogLevel] == [10, 20, 30, 40, 50]
