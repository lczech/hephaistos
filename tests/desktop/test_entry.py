from pathlib import Path

from hephaistos.desktop import entry


def test_the_entry_runs_this_hephaistos_with_its_directories() -> None:
    env = {"HEPHAISTOS_HOME": "/data/scratch", "XDG_DATA_HOME": "", "OTHER": "x"}
    lines = entry.entry_text(Path("/home/me/.local/bin/hephaistos"), env).splitlines()
    assert lines[1:3] == ["[Desktop Entry]", "Type=Application"]
    assert (
        "Exec=env HEPHAISTOS_HOME=/data/scratch /home/me/.local/bin/hephaistos desktop open"
        in lines
    )
    assert "StartupWMClass=hephaistos" in lines
    assert "Icon=hephaistos" in lines


def test_exec_arguments_are_quoted_as_the_specification_asks() -> None:
    lines = entry.entry_text(Path('/opt/my "tools" $x/50%/hephaistos'), {}).splitlines()
    assert 'Exec="/opt/my \\"tools\\" \\$x/50%%/hephaistos" desktop open' in lines


def test_installs_and_removes_its_files(tmp_path: Path) -> None:
    files = entry.Files.from_environment({"XDG_DATA_HOME": str(tmp_path)})
    assert files.entry == tmp_path / "applications" / "hephaistos.desktop"
    icon = tmp_path / "icon.svg"
    icon.write_text("<svg/>")
    assert entry.install(files, "text", icon)
    assert not entry.install(files, "text", icon)
    assert entry.install(files, "other", icon)
    assert files.icon.read_text() == "<svg/>"
    assert entry.uninstall(files)
    assert not entry.uninstall(files)
