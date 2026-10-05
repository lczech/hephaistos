"""What Events are about: the subject types, from the kinds' prefixes, and who knows them."""

import uuid
from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping
from pathlib import Path

from hephaistos.core.db.sessions import ReadSession
from hephaistos.core.events.events import Event
from hephaistos.core.registry import clones, filesystems, machines, mounts, repositories

type Label = str | Path
type Labeller = Callable[[ReadSession, Collection[uuid.UUID]], Mapping[uuid.UUID, Label]]

_LABELLERS: dict[str, Labeller] = {
    "machine": machines.labels,
    "filesystem": filesystems.labels,
    "mount": mounts.labels,
    "repository": repositories.labels,
    "clone": clones.labels,
}


def labels(session: ReadSession, events: Iterable[Event]) -> dict[uuid.UUID, Label]:
    """How to show the Events' subjects, by ID; missing for subject types we don't know."""
    by_type: defaultdict[str, set[uuid.UUID]] = defaultdict(set)
    for event in events:
        by_type[event.subject_type].add(event.subject)
    found: dict[uuid.UUID, Label] = {}
    for subject_type, ids in by_type.items():
        if (labeller := _LABELLERS.get(subject_type)) is not None:
            found |= labeller(session, ids)
    return found
