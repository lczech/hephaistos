import uuid

import pytest

from hephaistos.core.state.checkouts import CheckoutState, Condition, conditions
from hephaistos.core.utils.ids import Timestamp


def _state(*, present: bool = True, error: str | None = None) -> CheckoutState:
    return CheckoutState(
        observed_at=Timestamp(0),
        observed_by=uuid.UUID(int=0),
        present=present,
        error=error,
        head=None,
        branch=None,
        upstream=None,
        ahead=None,
        behind=None,
        staged=None,
        changed=None,
        untracked=None,
        conflicted=None,
    )


OK = _state()
MISSING = _state(present=False)
FAILED = _state(error="broken")


@pytest.mark.parametrize(
    ("old", "new", "expected"),
    [
        (OK, OK, []),
        (OK, MISSING, [Condition.MISSING]),
        (MISSING, OK, [Condition.FOUND]),
        (OK, FAILED, [Condition.FAILED]),
        (FAILED, OK, [Condition.RECOVERED]),
        (MISSING, FAILED, [Condition.FOUND, Condition.FAILED]),
        (FAILED, MISSING, [Condition.MISSING]),
        (FAILED, _state(error="broken differently"), []),
        (MISSING, MISSING, []),
    ],
)
def test_conditions(old: CheckoutState, new: CheckoutState, expected: list[Condition]) -> None:
    assert conditions(old, new) == expected
