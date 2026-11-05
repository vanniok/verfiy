"""High-accuracy extraction for PDFs that contain a real text layer."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import List, Sequence

import pdfplumber


TABLE_SETTINGS = {
    "vertical_strategy": "lines",
    "horizontal_strategy": "lines",
    "snap_tolerance": 3,
    "join_tolerance": 3,
    "intersection_tolerance": 5,
    "text_x_tolerance": 2,
    "text_y_tolerance": 3,
}


@dataclass
class NativePage:
    page_number: int
    text: str
    tables: List[List[List[str]]]
    markdown: str
    method: str
    quality_score: float


def _clean(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", " ", text)
    return text.strip()


def _is_header(row: Sequence[str], keywords: Sequence[str]) -> bool:
    text = "".join(_clean(cell) for cell in row)
    nonempty = sum(bool(_clean(cell)) for cell in row)
    return nonempty >= 3 and sum(word in text for word in keywords) >= 2


def _split_stacked_grid(
    raw_rows: List[List[object]], header_keywords: Sequence[str]
) -> List[List[List[str]]]:
    """
    pdfplumber may regard vertically stacked tables as one wide grid. Split on
    repeated header rows, then retain only columns that exist in each header.
    This also removes phantom columns introduced by the other table's lines.
    """
    rows = [[_clean(cell) for cell in row] for row in raw_rows]
    starts = [
        index for index, row in enumerate(rows) if _is_header(row, header_keywords)
    ]
    if not starts:
        return [[row for row in rows if any(row)]]

    tables: List[List[List[str]]] = []
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else len(rows)
        header = rows[start]
        active_columns = [index for index, value in enumerate(header) if value]
        if len(active_columns) < 2:
            continue

        logical_rows: List[List[str]] = []
        for row in rows[start:end]:
            projected = [row[index] if index < len(row) else "" for index in active_columns]
            if not any(projected):
                continue
            logical_rows.append(projected)
        if logical_rows:
            tables.append(logical_rows)
    return tables


def table_to_markdown(rows: Sequence[Sequence[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)

    def padded(row: Sequence[str]) -> List[str]:
        values = [_clean(value).replace("|", r"\|") for value in row]
        return values + [""] * (width - len(values))

    header = padded(rows[0])
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(padded(row)) + " |" for row in rows[1:])
    return "\n".join(lines)


def _outside_table_text(page, table_bboxes) -> str:
    """Extract text above/below table regions without duplicating table cells."""
    if not table_bboxes:
        return _clean(page.extract_text(x_tolerance=2, y_tolerance=3) or "")

    chunks = []
    cursor = 0.0
    for x0, top, x1, bottom in sorted(table_bboxes, key=lambda box: box[1]):
        if top > cursor:
            text = page.crop((0, cursor, page.width, top)).extract_text(
                x_tolerance=2, y_tolerance=3
            )
            if text and text.strip():
                chunks.append(text.strip())
        cursor = max(cursor, bottom)
    if cursor < page.height:
        text = page.crop((0, cursor, page.width, page.height)).extract_text(
            x_tolerance=2, y_tolerance=3
        )
        if text and text.strip():
            chunks.append(text.strip())
    return "\n".join(chunks)


def extract_native_pdf(
    pdf_path: str,
    min_native_chars: int = 20,
    header_keywords: Sequence[str] = (),
) -> List[NativePage]:
    pages: List[NativePage] = []
    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            raw_text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            useful_chars = re.sub(r"\s+", "", raw_text)
            if len(useful_chars) < min_native_chars:
                pages.append(
                    NativePage(page_number, "", [], "", "needs_ocr", 0.0)
                )
                continue

            found = page.find_tables(table_settings=TABLE_SETTINGS)
            tables: List[List[List[str]]] = []
            for grid in found:
                tables.extend(
                    _split_stacked_grid(
                        grid.extract(**TABLE_SETTINGS), header_keywords
                    )
                )

            outside_text = _outside_table_text(page, [table.bbox for table in found])
            parts = [outside_text] if outside_text else []
            parts.extend(table_to_markdown(table) for table in tables)
            markdown = "\n\n".join(part for part in parts if part)

            # Integrity only checks that the native layer contains no replacement
            # characters. Accuracy is measured separately against labelled truth.
            intact = sum(ch != "\ufffd" and ch.isprintable() for ch in useful_chars)
            quality = intact / max(len(useful_chars), 1)
            pages.append(
                NativePage(
                    page_number=page_number,
                    text=raw_text.strip(),
                    tables=tables,
                    markdown=markdown or raw_text.strip(),
                    method="native_pdf",
                    quality_score=quality,
                )
            )
    return pages
