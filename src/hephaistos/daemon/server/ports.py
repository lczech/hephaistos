"""Who listens on a port of this Machine, by user ID: so the token goes only to our own Server.

Any user can listen on a free port of 127.0.0.1, so a fixed port could be taken by someone
else's program, waiting for the token. Linux lists the listening sockets with their owners.
"""

import ipaddress
import struct
from pathlib import Path

PROC_TCP = Path("/proc/net/tcp")  # IPv4 sockets: what 127.0.0.1 reaches
PROC_TCP6 = Path("/proc/net/tcp6")  # IPv6 ones, reached too where they take IPv4 (dual-stack)
_LISTEN = "0A"  # the state column's value for a listening socket
_REACHED = frozenset(
    {
        ipaddress.ip_address("127.0.0.1"),
        ipaddress.ip_address("0.0.0.0"),  # noqa: S104 - matched, not bound
        ipaddress.ip_address("::"),  # unless IPV6_V6ONLY, which the table does not say
        ipaddress.ip_address("::ffff:127.0.0.1"),
    }
)


def _address(text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """An address as the kernel prints it: 32-bit words, each in this Machine's byte order."""
    words = [int(text[start : start + 8], 16) for start in range(0, len(text), 8)]
    return ipaddress.ip_address(b"".join(struct.pack("=I", word) for word in words))


def _holder(port: int, table: Path) -> int | None:
    try:
        lines = table.read_text().splitlines()[1:]
    except OSError:
        return None
    for line in lines:
        fields = line.split()
        if len(fields) < 8 or fields[3] != _LISTEN:  # noqa: PLR2004 - up to the uid column
            continue
        address, _, hex_port = fields[1].partition(":")
        if int(hex_port, 16) == port and _address(address) in _REACHED:
            return int(fields[7])
    return None


def holder(port: int, table: Path = PROC_TCP, table6: Path = PROC_TCP6) -> int | None:
    """The ID of the user listening on 127.0.0.1 at `port`; None if nobody, or Linux cannot say."""
    found = _holder(port, table)
    return _holder(port, table6) if found is None else found
