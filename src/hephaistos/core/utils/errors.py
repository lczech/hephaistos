from pathlib import Path


class HephaistosError(Exception):
    """An error with a message meant for the user."""

    exit_code = 1  # of a command that it ends


class NotSetUpError(HephaistosError):
    """This Machine has no database yet."""

    def __init__(self) -> None:
        """Creates the error with its message."""
        super().__init__("hephaistos is not set up on this machine; run `hephaistos setup`")


class AlreadySetUpError(HephaistosError):
    """Setup was run on a Machine that is already set up."""

    def __init__(self, database: Path) -> None:
        """Creates the error, naming the existing database."""
        super().__init__(f"hephaistos is already set up on this machine ({database})")


class DatabaseBusyError(HephaistosError):
    """Another process kept the database locked for longer than we wait."""

    def __init__(self, seconds: float) -> None:
        """Creates the error, saying how long we waited."""
        super().__init__(
            f"the database stayed busy for {seconds:g} s, as another hephaistos process"
            " is writing to it; try again"
        )


class SchemaMismatchError(HephaistosError):
    """The database schema is not that of this version: older, newer, or changed at one version."""

    def __init__(self, found: int, known: int) -> None:
        """Creates the error for a database with schema `found`; this version knows `known`."""
        reset = "run `hephaistos setup --reset` (keeps a backup)"
        this = "this version of hephaistos"
        if found > known:
            message = (
                f"the database has schema {found}, newer than {this} knows ({known});"
                " restart the daemon (`hephaistos daemon restart`) or update hephaistos"
            )
        elif found < known:
            message = f"the database has schema {found}; {this} needs {known}: {reset}"
        else:
            message = f"the database has schema {found}, which differs from that of {this}: {reset}"
        super().__init__(message)
