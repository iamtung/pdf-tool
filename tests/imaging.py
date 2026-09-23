"""Test helpers: render a page and compare with a simple global SSIM."""
import numpy as np
import pymupdf


def gray_page(path, index: int, width: int = 400) -> np.ndarray:
    with pymupdf.open(path) as d:
        page = d[index]
        s = width / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(s, s), colorspace=pymupdf.csGRAY, alpha=False)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).astype(np.float64)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = a.mean(), b.mean()
    va, vb = a.var(), b.var()
    cov = ((a - ma) * (b - mb)).mean()
    return ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma**2 + mb**2 + c1) * (va + vb + c2))
