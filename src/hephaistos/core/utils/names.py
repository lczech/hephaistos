"""Rules for the names of a kind of entity: checking a given name and deriving one from text."""

import re
from dataclasses import dataclass
from functools import cached_property

from hephaistos.core.utils.errors import HephaistosError


@dataclass(frozen=True, kw_only=True)
class Names:
    """What a kind of entity's names may be: the characters, a length and reserved names."""

    kind: str  # for messages, e.g. "repository"
    characters: str  # a regex character class's body, e.g. "A-Za-z0-9._-"
    described: str  # the characters for people, e.g. "ASCII letters, digits, '-' and '_'"
    max_length: int
    reserved: frozenset[str] = frozenset()

    @cached_property
    def _name(self) -> re.Pattern[str]:
        return re.compile(f"[{self.characters}]{{1,{self.max_length}}}")

    @cached_property
    def _others(self) -> re.Pattern[str]:
        return re.compile(f"[^{self.characters}]+")

    def check(self, name: str) -> None:
        """Raises HephaistosError unless `name` is one of these names."""
        if not self._name.fullmatch(name) or name in self.reserved:
            reserved = " or ".join(f"'{word}'" for word in sorted(self.reserved))
            raise HephaistosError(
                f"{name!r} is not a {self.kind} name: those have only {self.described},"
                f" at most {self.max_length}" + (f", and aren't {reserved}" if reserved else "")
            )

    def derived(self, text: str) -> str | None:
        """A name from `text`, e.g. a directory's: `My Thesis` → `My-Thesis`.

        Each run of characters a name can't have becomes a `-`, as GitHub does, without one at
        either end; None if no name is left.
        """
        name = self._others.sub("-", text).strip("-")[: self.max_length]
        return None if not name or name in self.reserved else name
