import re
from pathlib import Path

from hephaistos.core.config import ChassisSetting
from hephaistos.core.events.kinds import EventKind

ICONS = Path(__file__).parents[3] / "gui" / "web" / "src" / "icons.tsx"


def _keys(name: str) -> set[str]:
    """The keys of a map in the GUI's icons: `ACTIONS` has `committed`, `branch created`, …"""
    block = re.search(rf"const {name}[^{{]*\{{(.*?)\n\}};", ICONS.read_text(), re.DOTALL)
    assert block is not None, name
    return set(re.findall(r'^\s*"?([a-z. ]+)"?:', block.group(1), re.MULTILINE))


def test_every_kind_has_an_icon_in_the_gui() -> None:
    own, actions = _keys("KINDS"), _keys("ACTIONS")
    missing = {
        kind
        for kind in EventKind
        if kind not in own and kind.partition(".")[2].replace("_", " ") not in actions
    }
    assert missing == set()
    assert own <= set(EventKind)  # none for a kind that is gone


def test_every_chassis_has_an_icon_in_the_gui() -> None:
    assert {str(chassis) for chassis in ChassisSetting} - {"auto"} == _keys("CHASSIS")
