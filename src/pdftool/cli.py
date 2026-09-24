"""`pdftool` entry point: preflight, housekeeping, start server, open browser."""
import argparse
import os
import socket
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import quote

import uvicorn

from pdftool import housekeeping, instance
from pdftool.core.compressor import ghostscript_available

DEV_PORT = 8765


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _open_param(file: str | None) -> str:
    if not file:
        return ""
    return f"/?open={quote(str(Path(file).expanduser().resolve()))}"


def main() -> None:
    parser = argparse.ArgumentParser(prog="pdftool", description="Công cụ phân tích, chỉnh sửa và nén PDF")
    parser.add_argument("file", nargs="?", help="file PDF mở ngay khi khởi động")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--dev", action="store_true", help=f"backend only on port {DEV_PORT} for Vite dev server")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.dev:
        os.environ["PDFTOOL_DEV"] = "1"

    lock = instance.acquire()
    if lock is None:
        url = instance.read_url()
        if url is None:
            print("pdftool đã đang chạy nhưng không xác định được địa chỉ.", file=sys.stderr)
            sys.exit(1)
        print(f"pdftool đang chạy tại {url}")
        if not args.no_browser:
            webbrowser.open(url + _open_param(args.file))
        sys.exit(0)

    # Imported after PDFTOOL_DEV is set so create_app() sees the right env.
    from pdftool.server import create_app

    if not ghostscript_available():
        print("⚠️  Chưa có Ghostscript — tùy chọn nén mạnh nhất sẽ bị tắt. Cài bằng: brew install ghostscript")
    housekeeping.cleanup()

    port = args.port or (DEV_PORT if args.dev else free_port())
    url = f"http://127.0.0.1:{port}"
    instance.write_url(url)
    open_url = url + _open_param(args.file)
    if not (args.dev or args.no_browser):
        threading.Timer(1.0, webbrowser.open, args=(open_url,)).start()
    print(f"pdftool đang chạy tại {url}  (Ctrl+C để dừng)")
    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
