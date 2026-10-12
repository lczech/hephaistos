"""The API's shapes, held to a recorded snapshot, so that changing them bumps API_VERSION.

Additions only bump minor; anything else major, except descriptions. Once API_VERSION says so,
record the new snapshot: `HEPHAISTOS_RECORD_API=1 pytest tests/daemon/server/test_schema.py`.
"""

import json
import os
from pathlib import Path
from typing import Any, cast

import pytest

from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths
from hephaistos.core.views import API_VERSION, ApiVersion
from hephaistos.daemon.server.app import Counts, create_app
from support import FakeWatcher

SNAPSHOT = Path(__file__).with_name("api.json")


def _contains(old: object, new: object) -> bool:
    """Whether `new` has all of `old`, and maybe more."""
    if isinstance(old, dict) and isinstance(new, dict):
        new_fields = cast("dict[str, object]", new)
        return all(
            key in new_fields and _contains(value, new_fields[key])
            for key, value in cast("dict[str, object]", old).items()
        )
    if isinstance(old, list) and isinstance(new, list):
        new_items = cast("list[object]", new)
        return all(
            any(_contains(item, other) for other in new_items) for item in cast("list[object]", old)
        )
    return old == new


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
    old, new = _shape(old), _shape(new)
    if new == old:
        return was
    if _contains(old, new):
        return ApiVersion(was.major, was.minor + 1)
    return ApiVersion(was.major + 1, 0)


def test_api_version_follows_its_shapes(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    schema: dict[str, Any] = create_app(paths, Counts(), "0.1.0", FakeWatcher().observe).openapi()
    shapes = {key: value for key, value in schema.items() if key != "info"}
    recorded = json.loads(SNAPSHOT.read_text())
    was = ApiVersion(**recorded["api"])
    needed = required_version(was, recorded["shapes"], shapes)
    record = os.environ.get("HEPHAISTOS_RECORD_API")
    assert needed == API_VERSION, (
        f"the API's shapes changed since {was.major}.{was.minor}: API_VERSION must be"
        f" {needed.major}.{needed.minor}"
    )
    if record and shapes != recorded["shapes"]:
        snapshot = {"api": API_VERSION._asdict(), "shapes": shapes}
        SNAPSHOT.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
        pytest.skip(f"recorded {SNAPSHOT.name} at {API_VERSION.major}.{API_VERSION.minor}")
    assert shapes == recorded["shapes"], (
        f"record the changed shapes: HEPHAISTOS_RECORD_API=1 pytest {Path(__file__).name}"
    )


@pytest.mark.parametrize(
    ("old", "new", "needed"),
    [
        ({"a": 1}, {"a": 1}, (1, 2)),
        ({"a": 1}, {"a": 1, "b": 2}, (1, 3)),
        ({"a": [1, 2]}, {"a": [1, 2, 3]}, (1, 3)),
        ({"a": 1, "b": 2}, {"a": 1}, (2, 0)),
        ({"a": 1}, {"a": 2}, (2, 0)),
        ({"a": {"description": "old"}}, {"a": {"description": "new"}}, (1, 2)),
        ({"properties": {"description": {}}}, {"properties": {}}, (2, 0)),  # a field
    ],
)
def test_required_version(old: object, new: object, needed: tuple[int, int]) -> None:
    assert required_version(ApiVersion(1, 2), old, new) == needed
