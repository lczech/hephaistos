"""Rules for the names of a kind of entity: checking a given name and deriving one from text."""

import re
from dataclasses import dataclass
from functools import cached_property

from hephaistos.core.utils.errors import HephaistosError


@dataclass(frozen=True, kw_only=True)
class Names:
    """What the names of a kind of entity may be: the characters, a length and reserved names."""

    kind: str  # for messages, e.g. "repository"
    characters: str  # the body of a regex character class, e.g. "A-Za-z0-9._-"
    described: str  # the characters for people, e.g. "ASCII letters, digits, '-' and '_'"
    max_length: int
    reserved: frozenset[str] = frozenset()
    first: str | None = None  # the body of a character class for the first one, if narrower
    first_described: str = ""  # e.g. "a letter or digit"

    @cached_property
    def _first(self) -> re.Pattern[str]:
        return re.compile(f"[{self.first or self.characters}]")

    @cached_property
    def _name(self) -> re.Pattern[str]:
        return re.compile(
            f"[{self.first or self.characters}][{self.characters}]{{0,{self.max_length - 1}}}"
        )

    @cached_property
    def _others(self) -> re.Pattern[str]:
        return re.compile(f"[^{self.characters}]+")

    def check(self, name: str) -> None:
        """Raises HephaistosError unless `name` is one of these names."""
        if not self._name.fullmatch(name) or name in self.reserved:
            reserved = " or ".join(f"'{word}'" for word in sorted(self.reserved))
            raise HephaistosError(
                f"{name!r} is not a {self.kind} name: those have only {self.described},"
                f" at most {self.max_length}"
                + (f", start with {self.first_described}" if self.first else "")
                + (f", and are not {reserved}" if reserved else "")
            )

    def derived(self, text: str) -> str | None:
        """A name from `text`, e.g. the name of a directory: `My Thesis` → `My-Thesis`.

        Each run of characters a name cannot have becomes a `-`, as GitHub does, without one at
        either end; None if no name is left.
        """
        name = self._others.sub("-", text).strip("-")
        while name and not self._first.match(name):
            name = name[1:]
        name = name[: self.max_length]
        return None if not name or name in self.reserved else name
