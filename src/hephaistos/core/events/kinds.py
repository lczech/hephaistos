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
    REPOSITORY_ADDED = "repository.added"
    REPOSITORY_CHANGED = "repository.changed"
    CLONE_ADDED = "clone.added"
    CLONE_DELETED = "clone.deleted"
    CLONE_MISSING = "clone.missing"
    CLONE_FOUND = "clone.found"
    CLONE_FAILED = "clone.failed"
    CLONE_RECOVERED = "clone.recovered"
    CLONE_BRANCH_CREATED = "clone.branch_created"
    CLONE_BRANCH_DELETED = "clone.branch_deleted"
    CLONE_REMOTES_CHANGED = "clone.remotes_changed"
    CLONE_BRANCH_RENAMED = "clone.branch_renamed"
    CLONE_COMMITTED = "clone.committed"
    CLONE_MERGED = "clone.merged"
    CLONE_PULLED = "clone.pulled"
    CLONE_REBASED = "clone.rebased"
    CLONE_RESET = "clone.reset"
    CLONE_BRANCH_SWITCHED = "clone.branch_switched"
    CLONE_HEAD_MOVED = "clone.head_moved"
    CLONE_PUSHED = "clone.pushed"
    WORKTREE_ADDED = "worktree.added"
    WORKTREE_REMOVED = "worktree.removed"
    WORKTREE_MOVED = "worktree.moved"
    WORKTREE_MISSING = "worktree.missing"
    WORKTREE_FOUND = "worktree.found"
    WORKTREE_FAILED = "worktree.failed"
    WORKTREE_RECOVERED = "worktree.recovered"
    WORKTREE_COMMITTED = "worktree.committed"
    WORKTREE_MERGED = "worktree.merged"
    WORKTREE_PULLED = "worktree.pulled"
    WORKTREE_REBASED = "worktree.rebased"
    WORKTREE_RESET = "worktree.reset"
    WORKTREE_BRANCH_SWITCHED = "worktree.branch_switched"
    WORKTREE_HEAD_MOVED = "worktree.head_moved"

    @property
    def default_priority(self) -> Priority:
        """The priority the origin Machine gives Events of this kind."""
        # Exhaustive: the type checker reports a new kind missing here.
        match self:
            case (
                EventKind.MACHINE_ADDED
                | EventKind.FILESYSTEM_ADDED
                | EventKind.MOUNT_ADDED
                | EventKind.REPOSITORY_ADDED
                | EventKind.REPOSITORY_CHANGED
                | EventKind.CLONE_ADDED
                | EventKind.CLONE_DELETED
                | EventKind.CLONE_FOUND
                | EventKind.CLONE_RECOVERED
                | EventKind.CLONE_BRANCH_CREATED
                | EventKind.CLONE_BRANCH_DELETED
                | EventKind.CLONE_REMOTES_CHANGED
                | EventKind.WORKTREE_ADDED
                | EventKind.WORKTREE_REMOVED
                | EventKind.WORKTREE_MOVED
                # Only locked Worktrees go missing, and those are expected to be away at times.
                | EventKind.WORKTREE_MISSING
                | EventKind.WORKTREE_FOUND
                | EventKind.WORKTREE_RECOVERED
                # Git activity that integrates or publishes work, or may drop it.
                | EventKind.CLONE_MERGED
                | EventKind.CLONE_PULLED
                | EventKind.CLONE_REBASED
                | EventKind.CLONE_RESET
                | EventKind.CLONE_PUSHED
                | EventKind.WORKTREE_MERGED
                | EventKind.WORKTREE_PULLED
                | EventKind.WORKTREE_REBASED
                | EventKind.WORKTREE_RESET
            ):
                return Priority.NORMAL
            # Everyday git activity: frequent, and grouped by views.
            case (
                EventKind.CLONE_COMMITTED
                | EventKind.CLONE_BRANCH_SWITCHED
                | EventKind.CLONE_HEAD_MOVED
                | EventKind.CLONE_BRANCH_RENAMED
                | EventKind.WORKTREE_COMMITTED
                | EventKind.WORKTREE_BRANCH_SWITCHED
                | EventKind.WORKTREE_HEAD_MOVED
            ):
                return Priority.LOW
            case EventKind.CLONE_MISSING | EventKind.CLONE_FAILED | EventKind.WORKTREE_FAILED:
                return Priority.HIGH
