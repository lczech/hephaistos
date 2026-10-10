import ast
from pathlib import Path

PACKAGE = Path(__file__).parents[1] / "src" / "hephaistos"
CORE = PACKAGE / "core"
OTHER_PARTS = ("hephaistos.cli", "hephaistos.daemon", "hephaistos.plugins")


def _imported_modules(path: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.add(node.module)
    return modules


def test_core_imports_no_other_part() -> None:
    files = list(CORE.rglob("*.py"))
    assert files
    for path in files:
        for module in _imported_modules(path):
            assert not module.startswith(OTHER_PARTS), f"{path.name} imports {module}"


def test_daemon_imports_no_cli() -> None:
    files = list((PACKAGE / "daemon").rglob("*.py"))
    assert files
    for path in files:
        for module in _imported_modules(path):
            assert not module.startswith("hephaistos.cli"), f"{path.name} imports {module}"
