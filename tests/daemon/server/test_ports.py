import os
import socket
from pathlib import Path

import pytest

from hephaistos.daemon.errors import PartError
from hephaistos.daemon.server import ports, serve

TABLE = """\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:2048 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1234        0 1 1
   1: 0100007F:2049 0100007F:AC54 01 00000000:00000000 00:00000000 00000000  1234        0 2 1
   2: 00000000:2049 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1235        0 3 1
   3: 0101A8C0:204A 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1236        0 4 1
"""


def test_holder_from_the_table(tmp_path: Path) -> None:
    table = tmp_path / "tcp"
    table.write_text(TABLE)
    assert ports.holder(8264, table) == 1234  # 127.0.0.1, listening
    assert ports.holder(8265, table) == 1235  # 0.0.0.0 also takes 127.0.0.1's connections
    assert ports.holder(8266, table) is None  # 192.168.1.1 doesn't
    assert ports.holder(8267, table) is None
    assert ports.holder(8264, tmp_path / "missing") is None


def test_holder_of_a_real_socket() -> None:
    with socket.socket() as listening:
        listening.bind(("127.0.0.1", 0))
        listening.listen()
        assert ports.holder(listening.getsockname()[1]) == os.getuid()


def _another_user(_: int) -> int:
    return os.getuid() + 1


def test_a_squatter_is_named(monkeypatch: pytest.MonkeyPatch) -> None:
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen()
        port = taken.getsockname()[1]
        with pytest.raises(PartError, match=f"port {port} is in use; set server.port"):
            serve.bind(port)
        monkeypatch.setattr(ports, "holder", _another_user)
        with pytest.raises(PartError) as raised:
            serve.bind(port)
    assert str(raised.value) == (
        f"port {port} is held by another user (uid {os.getuid() + 1}); set server.port for this"
        " host, and renew the token (`hephaistos daemon token --renew`) if a client may have"
        " sent it there"
    )


def test_port_0_takes_a_free_one() -> None:
    with serve.bind(0) as bound:
        assert bound.getsockname()[1] > 0
