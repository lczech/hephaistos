"""The Server's errors: one shape for every answer other than success."""

from collections.abc import Mapping
from typing import Literal, TypedDict

from fastapi import HTTPException
from fastapi.responses import JSONResponse


class ErrorCheckoutJson(TypedDict):
    """The Checkout an error is about: a Clone, or a Worktree with its Clone."""

    clone: str
    worktree: str | None
    gone: Literal["clone", "worktree"] | None  # which was unregistered or removed, if one was


class ErrorJson(TypedDict):
    """An answer other than success (400, 401, 404, 410, 500, …), with the CLI's message."""

    error: str
    checkout: ErrorCheckoutJson | None  # None unless the error is about a Checkout


class CheckoutError(HTTPException):
    """An error about a Checkout, which the answer names: e.g. 410 for one that is gone."""

    def __init__(self, status: int, message: str, checkout: ErrorCheckoutJson) -> None:
        """An error with `status` and `message` about `checkout`."""
        super().__init__(status, message)
        self.checkout = checkout


def error_response(
    message: str,
    status: int,
    headers: Mapping[str, str] | None = None,
    checkout: ErrorCheckoutJson | None = None,
) -> JSONResponse:
    """`message` as an ErrorJson, with this status."""
    return JSONResponse(
        ErrorJson(error=message, checkout=checkout), status_code=status, headers=headers
    )
