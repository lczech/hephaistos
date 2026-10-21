"""The Server's errors: one shape for every answer other than success."""

from collections.abc import Mapping
from typing import TypedDict

from fastapi.responses import JSONResponse


class ErrorJson(TypedDict):
    """An answer other than success (400, 401, 404, 500, …), with the CLI's message."""

    error: str


def error_response(
    message: str, status: int, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    """`message` as an ErrorJson, with this status."""
    return JSONResponse(ErrorJson(error=message), status_code=status, headers=headers)
