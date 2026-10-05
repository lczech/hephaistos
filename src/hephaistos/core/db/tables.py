from enum import StrEnum


class Category(StrEnum):
    """Decides who may write a table and how it syncs (see decision 001)."""

    LOCAL = "local"
    REGISTRY = "registry"
    STATE = "state"
    EVENTS = "events"


class Table(StrEnum):
    """All tables of the schema; the name's prefix gives the category."""

    META = "meta"
    REGISTRY_MACHINES = "registry_machines"
    REGISTRY_FILESYSTEMS = "registry_filesystems"
    REGISTRY_MOUNTS = "registry_mounts"
    REGISTRY_REPOSITORIES = "registry_repositories"
    REGISTRY_CLONES = "registry_clones"
    STATE_CLONES = "state_clones"
    STATE_WORKTREES = "state_worktrees"
    EVENTS = "events"

    @property
    def category(self) -> Category:
        """The table's category, from its name."""
        if self is Table.META:
            return Category.LOCAL
        if self is Table.EVENTS:
            return Category.EVENTS
        return Category(self.value.split("_", 1)[0])
