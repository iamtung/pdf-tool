class PdfToolError(Exception):
    """Error with a stable machine-readable code (see spec §5)."""

    HTTP_STATUS = {
        "password_required": 401,
        "wrong_password": 403,
        "forbidden": 403,
        "not_found": 404,
        "file_changed": 409,
        "corrupted": 422,
        "gs_missing": 424,
        "bad_request": 400,
        "disk_full": 507,
        "internal": 500,
    }

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def http_status(self) -> int:
        return self.HTTP_STATUS.get(self.code, 500)
