"""`pdftool` entry point: preflight, housekeeping, start server, open browser."""
import argparse
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import quote

import uvicorn

from pdftool import housekeeping, instance
from pdftool.core.compressor import ghostscript_available

DEV_PORT = 8765
WAIT_FOR_URL_SECONDS = 5.0
WAIT_FOR_URL_STEP = 0.2


def _open_param(file: str | None) -> str:
    if not file:
        return ""
    return f"/?open={quote(str(Path(file).expanduser().resolve()))}"


def _wait_for_url() -> str | None:
    """Poll server.url for up to ~5s: the other instance may still be starting up."""
    deadline = time.monotonic() + WAIT_FOR_URL_SECONDS
    while True:
        url = instance.read_url()
        if url:
            return url
        if time.monotonic() >= deadline:
            return None
        time.sleep(WAIT_FOR_URL_STEP)


def ui_built() -> bool:
    from pdftool import server  # create_app() reads PDFTOOL_DEV at call time, so importing early is safe

    return (server.STATIC / "index.html").exists()


def main() -> None:
    parser = argparse.ArgumentParser(prog="pdftool", description="Công cụ phân tích, chỉnh sửa và nén PDF")
    parser.add_argument("file", nargs="?", help="file PDF mở ngay khi khởi động")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--dev", action="store_true", help=f"backend only on port {DEV_PORT} for Vite dev server")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.dev:
        os.environ["PDFTOOL_DEV"] = "1"
    elif not ui_built():
        print(
            "Chưa build giao diện web. Chạy lệnh sau rồi thử lại:\n"
            "    cd web && npm install && npm run build",
            file=sys.stderr,
        )
        sys.exit(1)

    lock = instance.acquire()
    if lock is None:
        url = _wait_for_url()
        if url is None:
            print("pdftool đang khởi động, thử lại sau giây lát.")
            sys.exit(0)
        print(f"pdftool đang chạy tại {url}")
        if not args.no_browser:
            webbrowser.open(url + _open_param(args.file))
        sys.exit(0)

    # A stale URL from a previous run must never be read by a concurrent second
    # launch before this instance has bound its own port.
    instance.clear_url()

    # Imported after PDFTOOL_DEV is set so create_app() sees the right env.
    from pdftool.server import create_app

    if not ghostscript_available():
        print("⚠️  Chưa có Ghostscript — tùy chọn nén mạnh nhất sẽ bị tắt. Cài bằng: brew install ghostscript")
    housekeeping.cleanup()

    port = args.port if args.port is not None else (DEV_PORT if args.dev else 0)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", port))
        sock.listen()
    except OSError as e:
        print(f"Không thể khởi động máy chủ trên cổng {port}: {e}", file=sys.stderr)
        sys.exit(1)

    actual_port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{actual_port}"
    # Only write server.url / announce readiness once the socket is actually bound
    # and listening.
    instance.write_url(url)
    open_url = url + _open_param(args.file)
    if not (args.dev or args.no_browser):
        threading.Timer(1.0, webbrowser.open, args=(open_url,)).start()
    print(f"pdftool đang chạy tại {url}  (Ctrl+C để dừng)")

    config = uvicorn.Config(create_app(), log_level="warning")
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
