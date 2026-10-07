import uuid
from datetime import UTC, datetime

import pytest

from hephaistos.core.db import values
from hephaistos.core.db.values import Decoder
from hephaistos.core.utils.ids import Timestamp

ID = uuid.UUID("0199c1e2-7a3b-7c41-9d2e-5b8f0a1c2d3e")
MS = 1759651200123


@pytest.mark.parametrize(
    ("decoder", "stored", "decoded"),
    [
        (values.plain, "text", "text"),
        (values.plain, 3, 3),
        (values.uuid_bytes, ID.bytes, ID),
        (values.hex_bytes, b"\x00\xff", "00ff"),
        (values.clock, Timestamp.of(MS, 3), Timestamp.of(MS, 3)),
        (values.milliseconds, MS, datetime(2025, 10, 5, 8, 0, 0, 123000, tzinfo=UTC)),
        (values.json_text, '{"a": [1]}', {"a": [1]}),
    ],
)
def test_decoders(decoder: Decoder, stored: object, decoded: object) -> None:
    assert decoder(stored) == decoded
    assert decoder(None) is None


@pytest.mark.parametrize(
    ("decoder", "stored", "shown"),
    [
        (values.uuid_bytes, b"\x01\x02", "0102"),
        (values.uuid_bytes, "text", "text"),
        (values.clock, -1, -1),
        (values.clock, "text", "text"),
        (values.milliseconds, 10**20, 10**20),
        (values.json_text, "{not json", "{not json"),
        (values.json_text, b"\xff", "ff"),
    ],
)
def test_values_that_dont_fit_are_shown_as_stored(
    decoder: Decoder, stored: object, shown: object
) -> None:
    assert decoder(stored) == shown
