"""macOS integration via osascript / open (spec §4.9)."""
import subprocess

TYPES = {"pdf": ['"com.adobe.pdf"'], "image": ['"public.jpeg"', '"public.png"']}


def _osascript(script: str) -> str | None:
    """Run AppleScript; returns stdout, or None if the user cancelled."""
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode != 0:
        return None  # -128 = user cancelled; treat any failure as "nothing picked"
    return r.stdout.strip()


def pick_files(kind: str = "pdf", multiple: bool = False) -> list[str]:
    types = ", ".join(TYPES[kind])
    prompt = "Chọn file PDF" if kind == "pdf" else "Chọn ảnh"
    multi = " with multiple selections allowed" if multiple else ""
    script = f'''
tell application "System Events"
    activate
    set picked to choose file of type {{{types}}} with prompt "{prompt}"{multi}
end tell
if class of picked is list then
    set out to ""
    repeat with f in picked
        set out to out & POSIX path of f & linefeed
    end repeat
    return out
else
    return POSIX path of picked
end if'''
    out = _osascript(script)
    return [line for line in (out or "").splitlines() if line]


def pick_folder() -> str | None:
    return _osascript('''
tell application "System Events"
    activate
    set picked to choose folder with prompt "Chọn thư mục lưu"
end tell
return POSIX path of picked''') or None


def reveal(path: str) -> None:
    subprocess.run(["open", "-R", "--", path], check=False)
