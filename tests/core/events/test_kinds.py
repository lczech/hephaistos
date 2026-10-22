import re
from pathlib import Path

from hephaistos.core.events.kinds import EventKind

ICONS = Path(__file__).parents[3] / "gui" / "web" / "src" / "icons.tsx"


def _actions_with_icons() -> set[str]:
    """The actions `ACTIONS` in the GUI's icons maps: `committed`, `branch created`."""
    block = re.search(r"const ACTIONS[^{]*\{(.*?)\n\};", ICONS.read_text(), re.DOTALL)
    assert block is not None
    return set(re.findall(r'^\s*"?([a-z ]+)"?:', block.group(1), re.MULTILINE))


def test_every_action_has_an_icon_in_the_gui() -> None:
    actions = {kind.partition(".")[2].replace("_", " ") for kind in EventKind}
    assert actions - _actions_with_icons() == set()
