"""Errores de negocio con su código HTTP y su código estable (docs/03-api.md)."""

from __future__ import annotations


class ApiError(Exception):
    """Error controlado. Se traduce a {"error": {"code", "message", "details"?}}."""

    status = 500
    code = "INTERNAL_ERROR"

    def __init__(self, message: str, *, details: list | None = None):
        super().__init__(message)
        self.message = message
        self.details = details

    def to_body(self) -> dict:
        error = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        return {"error": error}


class ValidationError(ApiError):
    status = 400
    code = "VALIDATION_ERROR"


class Unauthorized(ApiError):
    status = 401
    code = "UNAUTHORIZED"


class Forbidden(ApiError):
    status = 403
    code = "FORBIDDEN"


class NotFound(ApiError):
    status = 404
    code = "NOT_FOUND"


class Conflict(ApiError):
    status = 409
    code = "CONFLICT"


class LimitReached(ApiError):
    status = 409
    code = "LIMIT_REACHED"
