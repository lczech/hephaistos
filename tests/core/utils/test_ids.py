import pytest

from hephaistos.core.utils.ids import MAX_DRIFT_MS, Clock, ClockDriftError, Timestamp, new_id


class FakeWall:
    def __init__(self, ms: int) -> None:
        self.ms = ms

    def __call__(self) -> int:
        return self.ms


def test_new_id_is_uuid7_with_timestamp() -> None:
    ms = 1_759_651_200_000
    value = new_id(ms)
    assert value.version == 7
    assert value.variant == "specified in RFC 4122"
    assert value.int >> 80 == ms
    assert len(value.bytes) == 16


def test_new_ids_differ_within_same_millisecond() -> None:
    assert len({new_id(1000) for _ in range(1000)}) == 1000


def test_new_ids_sort_by_time() -> None:
    assert new_id(1000).bytes < new_id(1001).bytes


def test_timestamp_parts_and_order() -> None:
    value = Timestamp.of(123, 4)
    assert (value.ms, value.counter) == (123, 4)
    assert Timestamp.of(123, 65535) < Timestamp.of(124)


def test_timestamp_rejects_counter_out_of_range() -> None:
    with pytest.raises(ValueError, match="counter"):
        Timestamp.of(123, 65536)


def test_timestamp_text() -> None:
    value = Timestamp.of(1_759_651_200_123, 7)
    assert value.datetime.isoformat() == "2025-10-05T08:00:00.123000+00:00"
    assert str(value) == "2025-10-05 08:00:00.123 UTC #7"
    assert repr(value) == "Timestamp.of(1759651200123, 7)"


def test_timestamp_is_a_plain_integer_for_storage() -> None:
    value = Timestamp.of(1000, 2)
    assert isinstance(value, int)
    assert Timestamp(int(value)) == value


def test_tick_follows_wall_clock() -> None:
    wall = FakeWall(1000)
    clock = Clock(wall=wall)
    assert clock.tick() == Timestamp.of(1000)
    wall.ms = 2000
    assert clock.tick() == Timestamp.of(2000)


def test_tick_counts_within_same_millisecond() -> None:
    clock = Clock(wall=FakeWall(1000))
    ticks = [clock.tick() for _ in range(3)]
    assert ticks == [Timestamp.of(1000, 0), Timestamp.of(1000, 1), Timestamp.of(1000, 2)]


def test_tick_never_goes_backwards() -> None:
    wall = FakeWall(5000)
    clock = Clock(wall=wall)
    clock.tick()
    wall.ms = 1000  # wall clock jumped back
    assert clock.tick() == Timestamp.of(5000, 1)


def test_tick_counter_overflow_moves_to_next_millisecond() -> None:
    clock = Clock(last=Timestamp.of(1000, 65535), wall=FakeWall(1000))
    assert clock.tick() == Timestamp.of(1001)


def test_tick_resumes_from_persisted_value() -> None:
    clock = Clock(last=Timestamp.of(9000, 3), wall=FakeWall(1000))
    assert clock.tick() == Timestamp.of(9000, 4)


def test_tick_after_receive_sorts_after_received() -> None:
    # The local wall clock is behind the Peer's, e.g. a laptop running 5 minutes slow.
    clock = Clock(wall=FakeWall(1000))
    received = Timestamp.of(1000 + 5 * 60 * 1000, 2)
    clock.receive(received)
    assert clock.tick() > received


def test_receive_older_value_changes_nothing() -> None:
    clock = Clock(wall=FakeWall(5000))
    current = clock.tick()
    clock.receive(Timestamp.of(1000))
    assert clock.last == current


def test_receive_rejects_value_far_in_the_future() -> None:
    clock = Clock(wall=FakeWall(1000))
    with pytest.raises(ClockDriftError):
        clock.receive(Timestamp.of(1000 + MAX_DRIFT_MS + 1))
    assert clock.last == 0
