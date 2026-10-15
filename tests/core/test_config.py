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


def test_defaults_file_describes_every_setting() -> None:
    assert sorted(config.DESCRIPTIONS) == sorted(config.KEYS)
    assert all(config.DESCRIPTIONS.values())
    assert config.DESCRIPTIONS["git.timeout"].startswith("Seconds one git command may take;")


def test_settings_have_types() -> None:
    found = {key: config.setting_type(key) for key in config.KEYS}
    assert set(found.values()) <= {"bool", "int", "float", "text"}
    assert (found["git.timeout"], found["scan.depth"]) == ("float", "int")
    assert (found["server.enabled"], found["time_format"]) == ("bool", "text")


def test_descriptions_are_the_comments_right_above_a_key() -> None:
    text = """# About the file.

# Above a section.
[one]
# About the section.

# What two is,
# in two lines.
two = 2
three = 3
"""
    assert config.descriptions(text) == {"one.two": "What two is, in two lines.", "one.three": ""}


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
        "machine.chassis": config.DEFAULT,
        "log.level": "HEPHAISTOS_LOG_LEVEL",
        "log.retention_days": config.DEFAULT,
        "git.timeout": str(tmp_path / "config.login1.hpc.example.org.toml"),
        "observe.workers": config.DEFAULT,
        "scan.depth": config.DEFAULT,
        "watcher.interval": config.DEFAULT,
        "server.enabled": config.DEFAULT,
        "server.port": config.DEFAULT,
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
        ("[machines.laptop]\n", r"unknown setting machines \(did you mean machine\?\)"),
        ('[machine]\nchassis = "pc"\n', "machine.chassis must be one of auto, desktop, laptop"),
        (
            'time_format = "long"\n',
            'time_format must be one of auto, relative, short, full, not "long"',
        ),
        ('[git]\ntimeout = "1m"\n', 'git.timeout must be a number, not "1m"'),
        ("[git]\ntimeout = 0\n", "git.timeout must be more than 0, not 0.0"),
        ("[observe]\nworkers = 0\n", "observe.workers must be at least 1, not 0"),
        ("[observe]\nworkers = 2.5\n", "observe.workers must be an integer, not 2.5"),
        ("[scan]\ndepth = true\n", "scan.depth must be an integer, not true"),
        ("[server]\nenabled = 1\n", "server.enabled must be true or false, not 1"),
        ("[watcher]\ninterval = 0.5\n", "watcher.interval must be 0 or at least 1, not 0.5"),
        ("[watcher]\ninterval = -1\n", "watcher.interval must be 0 or at least 1, not -1"),
        ("[server]\nport = 70000\n", "server.port must be at most 65535, not 70000"),
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
        (
            "HEPHAISTOS_SERVER_ENABLED",
            "no",
            'HEPHAISTOS_SERVER_ENABLED: must be true or false, not "no"',
        ),
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


@pytest.mark.parametrize(
    ("text", "value"), [("true", True), ("1", True), ("FALSE", False), ("0", False)]
)
def test_boolean_variables(tmp_path: Path, text: str, value: bool) -> None:  # noqa: FBT001
    settings = load(tmp_path, "laptop", {"HEPHAISTOS_SERVER_ENABLED": text}).settings
    assert settings.server.enabled is value


def test_boolean_in_file(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text("[server]\nenabled = false\n")
    loaded = load(tmp_path, "laptop", {})
    assert loaded.settings.server.enabled is False
    assert config.setting_text(loaded.values["server.enabled"]) == "false"


def test_zero_turns_off(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text("[watcher]\ninterval = 0\n")
    assert load(tmp_path, "laptop", {}).settings.watcher.interval == 0


def test_activate() -> None:
    assert config.settings() is DEFAULTS
    chosen = dataclasses.replace(DEFAULTS, scan=config.Scan(depth=1))
    config.activate(chosen)
    assert config.settings() is chosen


def test_log_level_numbers() -> None:
    assert [level.number for level in LogLevel] == [10, 20, 30, 40, 50]


def test_layers_keep_what_is_broken_apart(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text("[git]\ntimeout = 60\n")
    (tmp_path / "config.laptop.toml").write_text("[git]\ntimeout = 0\n")
    env = {"HEPHAISTOS_SCAN_DEPTH": "5", "HEPHAISTOS_OBSERVE_WORKERS": "none"}
    found = config.layers(tmp_path, "laptop", env)
    assert [(Path(layer.source).name, layer.exists) for layer in found] == [
        ("config.toml", True),
        ("config.laptop.toml", True),
        ("HEPHAISTOS_OBSERVE_WORKERS", True),
        ("HEPHAISTOS_SCAN_DEPTH", True),
    ]
    assert [layer.error is None for layer in found] == [True, False, False, True]
    merged = config.merged(found)
    assert (merged.settings.git.timeout, merged.settings.scan.depth) == (60.0, 5)
    assert merged.values["observe.workers"] == 8
    with pytest.raises(ConfigError, match=r"git\.timeout must be more than 0"):
        load(tmp_path, "laptop", env)

    assert not config.layers(tmp_path, "desktop", {})[1].exists


def test_other_hosts_files(tmp_path: Path) -> None:
    for name in ("config.toml", "config.login1.toml", "config.login2.toml", "notes.toml"):
        (tmp_path / name).write_text("")
    other = config.other_hosts_files(tmp_path, "login1.hpc.example.org")
    assert [path.name for path in other] == ["config.login2.toml"]


def test_unknown_variables() -> None:
    env = {
        "HEPHAISTOS_HOME": "/x",
        "HEPHAISTOS_GIT_TIMEOUT": "3",
        "HEPHAISTOS_GIT_TIMOUT": "3",
        "HEPHAISTOS_COLOUR": "1",
        "PATH": "/bin",
    }
    assert config.unknown_variables(env) == {
        "HEPHAISTOS_COLOUR": None,
        "HEPHAISTOS_GIT_TIMOUT": "HEPHAISTOS_GIT_TIMEOUT",
    }
