from pathlib import Path


class HephaistosError(Exception):
    """An error with a message meant for the user."""


class NotSetUpError(HephaistosError):
    """This Machine has no database yet."""

    def __init__(self) -> None:
        """Creates the error with its message."""
        super().__init__("hephaistos is not set up on this Machine; run `hephaistos setup`")


class AlreadySetUpError(HephaistosError):
    """Setup was run on a Machine that is already set up."""

    def __init__(self, database: Path) -> None:
        """Creates the error, naming the existing database."""
        super().__init__(f"hephaistos is already set up on this Machine ({database})")


class SchemaOutdatedError(HephaistosError):
    """The database was created with a different schema than this version's."""

    def __init__(self) -> None:
        """Creates the error with its message."""
        super().__init__(
            "the database schema has changed; run `hephaistos setup --reset` (keeps a backup)"
        )
