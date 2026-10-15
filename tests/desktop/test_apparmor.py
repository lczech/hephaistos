from pathlib import Path

from hephaistos.desktop import apparmor

ELECTRON = Path("/home/me/my repos/hephaistos/gui/node_modules/electron/dist/electron")


def test_needed_where_user_namespaces_are_restricted(tmp_path: Path) -> None:
    restriction = tmp_path / "apparmor_restrict_unprivileged_userns"
    assert not apparmor.needed(restriction)
    restriction.write_text("0\n")
    assert not apparmor.needed(restriction)
    restriction.write_text("1\n")
    assert apparmor.needed(restriction)


def test_the_profile_lets_this_electron_create_user_namespaces(tmp_path: Path) -> None:
    text = apparmor.profile_text(ELECTRON)
    assert f'profile hephaistos-desktop "{ELECTRON}" flags=(unconfined) {{' in text.splitlines()
    assert "  userns," in text.splitlines()
    installed = tmp_path / "hephaistos-desktop"
    assert not apparmor.is_installed(ELECTRON, installed)
    installed.write_text(text)
    assert apparmor.is_installed(ELECTRON, installed)
    assert not apparmor.is_installed(ELECTRON.with_name("moved"), installed)


def test_installing_takes_two_commands_under_one_sudo() -> None:
    source = Path("/home/me/.local/state/x/hephaistos-desktop.apparmor")
    assert apparmor.commands(source) == [
        ["install", "-m", "644", str(source), "/etc/apparmor.d/hephaistos-desktop"],
        ["apparmor_parser", "-r", "/etc/apparmor.d/hephaistos-desktop"],
    ]
    assert apparmor.script(Path("/a b/p")) == (
        "install -m 644 '/a b/p' /etc/apparmor.d/hephaistos-desktop"
        " && apparmor_parser -r /etc/apparmor.d/hephaistos-desktop"
    )
