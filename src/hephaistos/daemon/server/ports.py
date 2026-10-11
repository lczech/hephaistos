"""Who listens on a port of this Machine, by user ID: so the token goes only to our own Server.

Any user can listen on a free port of 127.0.0.1, so a fixed port could be taken by someone
else's program, waiting for the token. Linux lists the listening sockets with their owners.
"""

import socket
import struct
from pathlib import Path

PROC_TCP = Path("/proc/net/tcp")  # IPv4 sockets: what 127.0.0.1 reaches
_LISTEN = "0A"  # the state column's value for a listening socket
_REACHED = frozenset({"127.0.0.1", "0.0.0.0"})  # noqa: S104 - matched, not bound


def holder(port: int, table: Path = PROC_TCP) -> int | None:
    """The ID of the user listening on 127.0.0.1 at `port`; None if nobody, or Linux won't say."""
    try:
        lines = table.read_text().splitlines()[1:]
    except OSError:
        return None
    for line in lines:
        fields = line.split()
        if len(fields) < 8 or fields[3] != _LISTEN:  # noqa: PLR2004 - up to the uid column
            continue
        address, _, hex_port = fields[1].partition(":")
        if int(hex_port, 16) != port:
            continue
        # The kernel prints the address as the number it keeps, in this Machine's byte order.
        if socket.inet_ntoa(struct.pack("=I", int(address, 16))) in _REACHED:
            return int(fields[7])
    return None
