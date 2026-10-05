"""Talking with the user at a terminal."""

import sys


def interactive() -> bool:
    """Whether we can ask the user."""
    return sys.stdin.isatty()
