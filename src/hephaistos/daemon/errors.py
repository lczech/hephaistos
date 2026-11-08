from hephaistos.core.utils.errors import HephaistosError

EX_CONFIG = 78  # sysexits' "configuration error"; systemd does not restart on it


class NotStartedError(HephaistosError):
    """The Daemon cannot start, and starting again will not help until something changes."""

    exit_code = EX_CONFIG


class PartError(HephaistosError):
    """A part of the Daemon cannot run, for a reason its message says; tried again later."""
