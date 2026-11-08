"""Links in our Markdown files, and paths under docs/ named in any tracked file: each must lead to
a file that exists, and an anchor to a heading in it."""

import re
from pathlib import Path

from support import ROOT, tracked_texts

FENCE = re.compile(r"^ {0,3}(```|~~~).*?^ {0,3}\1", re.MULTILINE | re.DOTALL)
CODE_SPAN = re.compile(r"`[^`\n]*`")
LINK = re.compile(r"\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")  # [text](target "title")
DEFINITION = re.compile(r"^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)", re.MULTILINE)
ATTRIBUTE = re.compile(r"\b(?:href|src|srcset)=\"([^\"]+)\"")
SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)  # https:, mailto:
NAMED = re.compile(r"(?<![\w./-])docs/[\w./-]*(?:#[\w-]+)?")  # as in a comment: (docs/glossary.md)
HEADING = re.compile(r"^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$", re.MULTILINE)
ANCHOR = re.compile(r"<a\s+(?:id|name)=\"([^\"]+)\"")


def _prose(text: str) -> str:
    """Markdown without its code blocks and code spans, where links are not links."""
    return CODE_SPAN.sub("", FENCE.sub("", text))


def slug(heading: str) -> str:
    """The anchor that GitHub gives a heading: its text, lowercase, without punctuation."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", heading)  # a link: its text
    text = re.sub(r"[`*_~]", "", text).strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def anchors(text: str) -> set[str]:
    """The anchors in a Markdown text: one per heading, numbered when repeated, and HTML ones."""
    found: set[str] = set(ANCHOR.findall(text))
    seen: dict[str, int] = {}
    for heading in HEADING.findall(FENCE.sub("", text)):
        base = slug(heading)
        count = seen.get(base, 0)
        seen[base] = count + 1
        found.add(base if count == 0 else f"{base}-{count}")
    return found


def problem(target: str, base: Path, texts: dict[str, str]) -> str | None:
    """What is wrong with a link to `target`, relative to `base`, or None if it leads somewhere."""
    path, _, anchor = target.partition("#")
    resolved = (base / path).resolve()
    if not resolved.exists():
        return "no such file"
    if not anchor or resolved.suffix != ".md" or not resolved.is_relative_to(ROOT):
        return None  # no anchor, or one into a file that is not Markdown or not ours
    text = texts.get(resolved.relative_to(ROOT).as_posix())
    if text is None or anchor in anchors(text):
        return None
    return f"no heading for #{anchor}"


def broken() -> list[str]:
    """Each link or named path that leads nowhere: file, line, target and why."""
    texts = dict(tracked_texts())
    found: list[str] = []
    for name, text in texts.items():
        here = (ROOT / name).parent
        targets = [(target, ROOT) for target in NAMED.findall(text)]
        if name.endswith(".md"):
            prose = _prose(text)
            for pattern in (LINK, DEFINITION, ATTRIBUTE):
                targets += [(t, here) for t in pattern.findall(prose) if not SCHEME.match(t)]
        for target, base in targets:
            # An anchor alone points into the same file.
            full = Path(name).name + target if target.startswith("#") else target
            if why := problem(full, base, texts):
                line = next((i for i, row in enumerate(text.splitlines(), 1) if target in row), 0)
                found.append(f"{name}:{line}: {target}: {why}")
    return list(dict.fromkeys(found))  # a link whose text names its path: once


def test_links_lead_somewhere() -> None:
    found = broken()
    assert not found, "fix these links and paths:\n" + "\n".join(found)


def test_slugs_are_those_of_github() -> None:
    assert slug("A worktree's GUI") == "a-worktrees-gui"
    assert slug("Words in `code`, and *emphasis*") == "words-in-code-and-emphasis"
    assert slug("[ADR 002](decisions/002.md): components") == "adr-002-components"
    assert anchors("# Tests\n## Tests\n```\n# not a heading\n```\n") == {"tests", "tests-1"}
