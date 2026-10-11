from hephaistos.core.utils.errors import HephaistosError

EX_CONFIG = 78  # sysexits' "configuration error"; systemd doesn't restart on it


class NotStartedError(HephaistosError):
    """The Daemon can't start, and starting again won't help until something changes."""

    exit_code = EX_CONFIG


class PartError(HephaistosError):
    """A part of the Daemon can't run, for a reason its message says; tried again later."""
