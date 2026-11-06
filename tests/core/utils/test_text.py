from hephaistos.core.utils.text import number_text, size_text


def test_counts_with_their_nouns() -> None:
    assert (number_text(1, "Clone"), number_text(2, "Clone")) == ("1 Clone", "2 Clones")
    assert number_text(2, "entry", "entries") == "2 entries"


def test_gives_sizes_as_the_gui_does() -> None:
    sizes = [512, 3400, 12_345, 1_200_000, 5e9]
    assert [size_text(int(size)) for size in sizes] == [
        "512 B",
        "3.4 kB",
        "12 kB",
        "1.2 MB",
        "5.0 GB",
    ]


def test_gives_sizes_in_the_unit_they_round_to() -> None:
    sizes = [999, 9_960, 999_499, 999_600, 9_960_000]
    assert [size_text(size) for size in sizes] == ["999 B", "10 kB", "999 kB", "1.0 MB", "10 MB"]
