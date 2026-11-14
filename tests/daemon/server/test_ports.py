import os
import socket
from pathlib import Path

import pytest

from hephaistos.daemon.errors import PartError
from hephaistos.daemon.server import ports, server

TABLE = """\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:2048 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1234        0 1 1
   1: 0100007F:2049 0100007F:AC54 01 00000000:00000000 00:00000000 00000000  1234        0 2 1
   2: 00000000:2049 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1235        0 3 1
   3: 0101A8C0:204A 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1236        0 4 1
"""


TABLE6 = """\
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:2048 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1237        0 5 1
   1: 0000000000000000FFFF00000100007F:204B 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1238        0 6 1
   2: 00000000000000000000000001000000:204C 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1239        0 7 1
"""  # noqa: E501 - as Linux prints it


def test_holder_from_the_tables(tmp_path: Path) -> None:
    table, table6, missing = tmp_path / "tcp", tmp_path / "tcp6", tmp_path / "missing"
    table.write_text(TABLE)
    table6.write_text(TABLE6)
    assert ports.holder(8264, table, missing) == 1234  # 127.0.0.1, listening
    assert ports.holder(8265, table, missing) == 1235  # 0.0.0.0 also takes 127.0.0.1's
    assert ports.holder(8266, table, missing) is None  # 192.168.1.1 does not
    assert ports.holder(8267, table, missing) is None
    assert ports.holder(8264, missing, missing) is None
    assert ports.holder(8264, missing, table6) == 1237  # ::, dual-stack as by default
    assert ports.holder(8264, table, table6) == 1234  # IPv4 first: our own Server
    assert ports.holder(8267, missing, table6) == 1238  # ::ffff:127.0.0.1
    assert ports.holder(8268, missing, table6) is None  # ::1 takes no IPv4


def test_holder_of_a_real_dual_stack_socket() -> None:
    try:
        listening = socket.socket(socket.AF_INET6)
    except OSError as error:
        pytest.skip(f"no IPv6 here: {error}")
    with listening:
        try:
            listening.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            listening.bind(("::", 0))
        except OSError as error:
            pytest.skip(f"no IPv6 here: {error}")
        listening.listen()
        assert ports.holder(listening.getsockname()[1]) == os.getuid()


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
            server.bind(port)
        monkeypatch.setattr(ports, "holder", _another_user)
        with pytest.raises(PartError) as raised:
            server.bind(port)
    assert str(raised.value) == (
        f"port {port} is held by another user (uid {os.getuid() + 1}); set server.port for this"
        " host, and renew the token (`hephaistos daemon token --renew`) if a client may have"
        " sent it there"
    )


def test_port_0_takes_a_free_one_on_127_0_0_1_only() -> None:
    with server.bind(0) as bound:
        host, port = bound.getsockname()
    assert (host, port > 0) == ("127.0.0.1", True)
