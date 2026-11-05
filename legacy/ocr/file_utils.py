"""File loading and PDF rendering helpers."""

from __future__ import annotations

import io
from pathlib import Path
from typing import List, Optional

import fitz
from PIL import Image


def get_file_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in {".png", ".jpg", ".jpeg"}:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext in {".doc", ".docx"}:
        return "word"
    if ext in {".xls", ".xlsx", ".csv"}:
        return "spreadsheet"
    return "unknown"


def load_image_file(file_path: str) -> Optional[Image.Image]:
    try:
        with Image.open(file_path) as image:
            return image.convert("RGB")
    except Exception:
        return None


def pdf_to_images(pdf_path: str, dpi: int = 220) -> List[Image.Image]:
    images: List[Image.Image] = []
    document = fitz.open(pdf_path)
    try:
        scale = dpi / 72
        matrix = fitz.Matrix(scale, scale)
        for page in document:
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            with Image.open(io.BytesIO(pixmap.tobytes("png"))) as image:
                images.append(image.convert("RGB"))
    finally:
        document.close()
    return images
