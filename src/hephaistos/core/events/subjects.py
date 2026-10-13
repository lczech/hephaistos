"""What Events are about: the subject types, from the kinds' prefixes, and who knows them."""

import uuid
from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping
from pathlib import Path

from hephaistos.core.db.sessions import ReadSession
from hephaistos.core.events.events import Event
from hephaistos.core.registry import clones, filesystems, machines, mounts, repositories
from hephaistos.core.state import worktrees

type Lookup[T] = Callable[[ReadSession, Collection[uuid.UUID]], Mapping[uuid.UUID, T]]

_NAMES: dict[str, Lookup[str]] = {
    "machine": machines.names,
    "filesystem": filesystems.names,
    "repository": repositories.names,
}
_PATHS: dict[str, Lookup[Path]] = {
    "mount": mounts.paths,
    "clone": clones.paths,
    "worktree": worktrees.paths,
}


def _by_type(events: Iterable[Event]) -> dict[str, set[uuid.UUID]]:
    by_type: defaultdict[str, set[uuid.UUID]] = defaultdict(set)
    for event in events:
        by_type[event.subject_type].add(event.subject)
    return by_type


def _look_up[T](
    session: ReadSession, events: Iterable[Event], lookups: Mapping[str, Lookup[T]]
) -> dict[uuid.UUID, T]:
    found: dict[uuid.UUID, T] = {}
    for subject_type, ids in _by_type(events).items():
        if (lookup := lookups.get(subject_type)) is not None:
            found |= lookup(session, ids)
    return found


def names(session: ReadSession, events: Iterable[Event]) -> dict[uuid.UUID, str]:
    """The names of the Events' subjects that have one: Machines, Filesystems, Repositories."""
    return _look_up(session, events, _NAMES)


def paths(session: ReadSession, events: Iterable[Event]) -> dict[uuid.UUID, Path]:
    """The paths of the Events' subjects that have one: Mounts, Clones, Worktrees."""
    return _look_up(session, events, _PATHS)


def repository_ids(session: ReadSession, events: Iterable[Event]) -> dict[uuid.UUID, uuid.UUID]:
    """The Repository of each Event's subject, by subject: itself, or its Clone's or Worktree's.

    Missing for subjects of no Repository: Machines, Filesystems, Mounts.
    """
    by_type = _by_type(events)
    in_clones = by_type.get("clone", set())
    clone_of = worktrees.clone_ids(session, by_type.get("worktree", set()))
    repository_of = clones.repository_ids(session, in_clones | set(clone_of.values()))
    found = {repository: repository for repository in by_type.get("repository", set())}
    found |= {clone: repository_of[clone] for clone in in_clones if clone in repository_of}
    found |= {
        worktree: repository_of[clone]
        for worktree, clone in clone_of.items()
        if clone in repository_of
    }
    return found
