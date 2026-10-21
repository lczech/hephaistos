"""The API's shapes, held to a recorded snapshot, so that changing them bumps API_VERSION.

Before 1.0, any change bumps minor, except to descriptions. After it, whether a change only adds
depends on its direction: a new required parameter breaks clients, a new value in an answer may.
Rules that tell requests from answers come with 1.0, and until then 1.x is refused (ADR 004).
Once API_VERSION says so, record the new snapshot, and with it the schema the
GUI's types are made from: `HEPHAISTOS_RECORD_API=1 pytest tests/daemon/server/test_schema.py`.
"""

import json
import os
from pathlib import Path
from typing import cast

import pytest

from hephaistos.core.registry import machines
from hephaistos.core.serialize import API_VERSION, ApiVersion
from hephaistos.core.utils.paths import Paths
from support import openapi

SNAPSHOT = Path(__file__).with_name("api.json")
GUI_SCHEMA = Path(__file__).parents[3] / "gui" / "web" / "openapi.json"
RECORD = "HEPHAISTOS_RECORD_API"


def _shape(value: object) -> object:
    """A schema without its descriptions, which don't change what clients get."""
    if isinstance(value, dict):
        return {
            key: _shape(item)
            for key, item in cast("dict[str, object]", value).items()
            if not (key == "description" and isinstance(item, str))
        }
    if isinstance(value, list):
        return [_shape(item) for item in cast("list[object]", value)]
    return value


def required_version(was: ApiVersion, old: object, new: object) -> ApiVersion:
    """The version the API needs, after shapes `old` at version `was` became `new`."""
    if _shape(new) == _shape(old):
        return was
    if was.major == 0:
        return ApiVersion(0, was.minor + 1)
    raise NotImplementedError("1.x needs rules that tell additions from breaking changes")


def test_api_version_follows_its_shapes(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    shapes = {key: value for key, value in openapi(paths).items() if key != "info"}
    recorded = json.loads(SNAPSHOT.read_text())
    was = ApiVersion(**recorded["api"])
    needed = required_version(was, recorded["shapes"], shapes)
    record = os.environ.get(RECORD)
    assert needed == API_VERSION, (
        f"the API's shapes changed since {was.major}.{was.minor}: API_VERSION must be"
        f" {needed.major}.{needed.minor}"
    )
    if record and shapes != recorded["shapes"]:
        snapshot = {"api": API_VERSION._asdict(), "shapes": shapes}
        SNAPSHOT.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
        pytest.skip(f"recorded {SNAPSHOT.name} at {API_VERSION.major}.{API_VERSION.minor}")
    assert shapes == recorded["shapes"], (
        f"record the changed shapes: {RECORD}=1 pytest {Path(__file__).name}"
    )


def test_the_gui_has_the_current_schema(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    schema = json.dumps(openapi(paths), indent=2, sort_keys=True) + "\n"
    recorded = GUI_SCHEMA.read_text() if GUI_SCHEMA.exists() else None
    if os.environ.get(RECORD) and schema != recorded:
        GUI_SCHEMA.write_text(schema)
        pytest.skip(f"recorded {GUI_SCHEMA.name} for the GUI")
    assert schema == recorded, f"record the GUI's schema: {RECORD}=1 pytest {Path(__file__).name}"


@pytest.mark.parametrize(
    ("old", "new", "needed"),
    [
        ({"a": 1}, {"a": 1}, (0, 4)),
        ({"a": 1}, {"a": 1, "b": 2}, (0, 5)),
        ({"a": 1, "b": 2}, {"a": 1}, (0, 5)),
        ({"a": {"description": "old"}}, {"a": {"description": "new"}}, (0, 4)),
        ({"properties": {"description": {}}}, {"properties": {}}, (0, 5)),  # a field
    ],
)
def test_required_version_before_1_0(old: object, new: object, needed: tuple[int, int]) -> None:
    assert required_version(ApiVersion(0, 4), old, new) == needed


def test_no_rules_for_1_x_yet() -> None:
    with pytest.raises(NotImplementedError):
        required_version(ApiVersion(1, 0), {"a": 1}, {"a": 1, "b": 2})
