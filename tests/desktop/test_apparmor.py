from pathlib import Path

from hephaistos.desktop import apparmor

ELECTRON = Path("/home/me/my repos/hephaistos/gui/node_modules/electron/dist/electron")


def test_needed_where_user_namespaces_are_restricted() -> None:
    assert not apparmor.needed()  # no such setting
    apparmor.RESTRICTION.write_text("0\n")
    assert not apparmor.needed()
    apparmor.RESTRICTION.write_text("1\n")
    assert apparmor.needed()


def test_the_profile_lets_this_electron_create_user_namespaces() -> None:
    text = apparmor.profile_text(ELECTRON)
    assert f'profile hephaistos-desktop "{ELECTRON}" flags=(unconfined) {{' in text.splitlines()
    assert "  userns," in text.splitlines()
    installed = apparmor.INSTALLED
    assert not apparmor.is_installed(ELECTRON)
    installed.parent.mkdir()
    installed.write_text(text)
    assert apparmor.is_installed(ELECTRON)
    assert not apparmor.is_installed(ELECTRON.with_name("moved"))


def test_installing_and_removing_take_two_commands_each() -> None:
    source = Path("/home/me/.local/state/x/hephaistos-desktop.apparmor")
    installed = str(apparmor.INSTALLED)
    assert apparmor.commands(source) == [
        ["install", "-m", "644", str(source), installed],
        ["apparmor_parser", "-r", installed],
    ]
    assert apparmor.script(apparmor.commands(Path("/a b/p"))) == (
        f"install -m 644 '/a b/p' {installed} && apparmor_parser -r {installed}"
    )
    assert apparmor.removal_commands() == [
        ["apparmor_parser", "-R", installed],
        ["rm", installed],
    ]
