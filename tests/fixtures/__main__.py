"""`python -m tests.fixtures <dir>`: write sample PDFs (used by the Playwright e2e test)."""
import sys
from pathlib import Path

from tests.fixtures import make

out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures-out")
out.mkdir(parents=True, exist_ok=True)
make.mixed_pdf(out / "mixed.pdf")
print(out / "mixed.pdf")
