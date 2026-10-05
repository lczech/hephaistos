from typer.testing import CliRunner

from hephaistos import __version__
from hephaistos.cli.main import app


def test_version() -> None:
    result = CliRunner().invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip() == f"hephaistos {__version__}"
