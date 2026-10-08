"""The log as text."""

import json
import logging
from collections.abc import Mapping
from datetime import datetime
from typing import override

from hephaistos.core.utils.logs import JsonFormatter

# Fields every record has, shown in fixed places; the rest follow as `key=value`.
_FIXED = frozenset({"at", "level", "process", "pid", "logger", "message", "error", "stack"})


def _value_text(value: object) -> str:
    """A field's value: strings as they are, anything else as JSON."""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def record_text(fields: Mapping[str, object]) -> str:
    """A record as one line in local time, with its traceback (if any) indented below.

    E.g. `14:03:21.123 INFO  cli[4242] recorded clone.moved event=… subject=…`.
    """
    at = datetime.fromisoformat(str(fields["at"])).astimezone()
    parts = [
        f"{at:%H:%M:%S}.{at.microsecond // 1000:03d}",
        f"{fields['level']!s:<5}",
        f"{fields['process']}[{fields['pid']}]",
        str(fields["message"]),
        *(f"{key}={_value_text(value)}" for key, value in fields.items() if key not in _FIXED),
    ]
    lines = [" ".join(parts)]
    for key in ("error", "stack"):
        if key in fields:
            lines += (f"    {line}" for line in str(fields[key]).splitlines())
    return "\n".join(lines)


class TextFormatter(logging.Formatter):
    """Records as `record_text` shows them when read back from the log file."""

    def __init__(self, process: str) -> None:
        """Formats records of a process of this kind: `cli` or `daemon`."""
        super().__init__()
        self._json = JsonFormatter(process)

    @override
    def format(self, record: logging.LogRecord) -> str:
        return record_text(json.loads(self._json.format(record)))
