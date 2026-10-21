import ast
import subprocess
import sys
from pathlib import Path

import pytest

PACKAGE = Path(__file__).parents[1] / "src" / "hephaistos"
PARTS = ("core", "cli", "daemon", "desktop", "plugins")
# The parts each part may import besides itself: dependencies point towards the Core (ADR 002),
# and the CLI, one command for everything, also starts the Daemon and the Desktop.
ALLOWED = {
    "core": set[str](),
    "daemon": {"core"},
    "desktop": {"core"},
    "cli": {"core", "daemon", "desktop"},
}


def _imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.add(node.module)
    return modules


@pytest.mark.parametrize("part", sorted(ALLOWED))
def test_parts_import_only_what_they_may(part: str) -> None:
    files = list((PACKAGE / part).rglob("*.py"))
    assert files
    forbidden = tuple(
        f"hephaistos.{other}" for other in PARTS if other not in {part, *ALLOWED[part]}
    )
    for path in files:
        for module in _imported_modules(path):
            assert not module.startswith(forbidden), f"{path.name} imports {module}"


def test_the_cli_starts_without_the_server_libraries() -> None:
    """They take a tenth of a second to import, which Tab completion would feel."""
    heavy = ("fastapi", "starlette", "pydantic", "uvicorn", "websockets")
    code = "import sys, hephaistos.cli.main; print(' '.join(sorted(sys.modules)))"
    loaded = subprocess.run(
        [sys.executable, "-c", code], check=True, capture_output=True, text=True
    ).stdout.split()
    assert [module for module in loaded if module.split(".")[0] in heavy] == []
