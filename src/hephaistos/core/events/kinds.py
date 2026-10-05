from enum import IntEnum, StrEnum


class Priority(IntEnum):
    """How much attention an Event deserves; high and above are pushed right away."""

    LOW = 10
    NORMAL = 20
    HIGH = 30
    URGENT = 40


class EventKind(StrEnum):
    """Stored as text; the part before the dot names the subject's type."""

    MACHINE_ADDED = "machine.added"
    FILESYSTEM_ADDED = "filesystem.added"
    MOUNT_ADDED = "mount.added"

    @property
    def default_priority(self) -> Priority:
        """The priority the origin Machine gives Events of this kind."""
        # Exhaustive: the type checker reports a new kind missing here.
        match self:
            case EventKind.MACHINE_ADDED | EventKind.FILESYSTEM_ADDED | EventKind.MOUNT_ADDED:
                return Priority.NORMAL
