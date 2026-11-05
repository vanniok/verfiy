"""Utilities for exporting user-edited OCR results."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re
from typing import Iterable, Sequence

from docx import Document


PAGE_MARKER = re.compile(r"^=====\s*(.+?)\s*=====$")
HEADING = re.compile(r"^(#{1,6})\s+(.+)$")
ORDERED_ITEM = re.compile(r"^\s*\d+[.)]\s+(.+)$")


def safe_download_stem(filename: str) -> str:
    """Return a filesystem-friendly source stem for download filenames."""
    stem = Path(filename).stem.strip() or "识别结果"
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", stem).rstrip(". ") or "识别结果"


def combine_pages(page_outputs: Sequence[str]) -> str:
    """Create one editable document while retaining page boundaries."""
    cleaned = [str(text or "").strip() for text in page_outputs]
    if len(cleaned) == 1:
        return cleaned[0]
    return "\n\n".join(
        f"===== 第 {index} 页 =====\n{text}"
        for index, text in enumerate(cleaned, start=1)
    )


def combine_labeled_sections(labels: Sequence[str], outputs: Sequence[str]) -> str:
    """Join named worksheet/section outputs without losing their source names."""
    return "\n\n".join(
        f"===== {label} =====\n{str(text or '').strip()}"
        for label, text in zip(labels, outputs)
    )


def text_download_bytes(text: str) -> bytes:
    """UTF-8 with BOM opens correctly in common Chinese Windows editors."""
    return text.encode("utf-8-sig")


def markdown_download_bytes(text: str) -> bytes:
    return text.encode("utf-8")


def _split_markdown_row(line: str) -> list[str]:
    """Split a Markdown table row while preserving escaped vertical bars."""
    value = line.strip()
    if value.startswith("|"):
        value = value[1:]
    if value.endswith("|") and not value.endswith(r"\|"):
        value = value[:-1]

    cells: list[str] = []
    current: list[str] = []
    index = 0
    while index < len(value):
        character = value[index]
        # Only Markdown's escaped pipe is decoded. Ordinary backslashes in
        # Windows paths such as C:\Users must remain untouched.
        if character == "\\" and index + 1 < len(value) and value[index + 1] == "|":
            current.append("|")
            index += 2
            continue
        if character == "|":
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(character)
        index += 1
    cells.append("".join(current).strip())
    return [
        re.sub(r"<br\s*/?>", "\n", cell, flags=re.IGNORECASE)
        for cell in cells
    ]


def _is_table_separator(cells: Iterable[str]) -> bool:
    values = list(cells)
    return bool(values) and all(
        re.fullmatch(r":?-{3,}:?", value.replace(" ", "")) is not None
        for value in values
    )


def _looks_like_table_start(lines: Sequence[str], index: int) -> bool:
    if index + 1 >= len(lines) or "|" not in lines[index]:
        return False
    header = _split_markdown_row(lines[index])
    separator = _split_markdown_row(lines[index + 1])
    return len(header) >= 1 and len(separator) == len(header) and _is_table_separator(
        separator
    )


def table_rows_to_markdown(rows: Sequence[Sequence[str]]) -> str:
    """Render editable table rows back to portable Markdown."""
    if not rows:
        return ""
    width = max((len(row) for row in rows), default=0)
    if width == 0:
        return ""

    def format_row(row: Sequence[str]) -> str:
        values = []
        for value in row:
            clean = str(value or "").replace("|", r"\|").replace("\n", "<br>")
            values.append(clean)
        values += [""] * (width - len(values))
        return "| " + " | ".join(values) + " |"

    return "\n".join(
        [format_row(rows[0]), "| " + " | ".join(["---"] * width) + " |"]
        + [format_row(row) for row in rows[1:]]
    )


def markdown_to_blocks(text: str) -> list[dict]:
    """Split recognised Markdown into ordered editable text/table blocks."""
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[dict] = []
    text_lines: list[str] = []

    def flush_text() -> None:
        value = "\n".join(text_lines).strip("\n")
        if value:
            blocks.append({"type": "text", "text": value})
        text_lines.clear()

    index = 0
    while index < len(lines):
        if _looks_like_table_start(lines, index):
            flush_text()
            rows = [_split_markdown_row(lines[index])]
            index += 2
            width = len(rows[0])
            while index < len(lines):
                candidate = lines[index].strip()
                if not (candidate.startswith("|") and candidate.endswith("|")):
                    break
                parsed = _split_markdown_row(lines[index])
                if len(parsed) != width:
                    break
                rows.append(parsed)
                index += 1
            blocks.append({"type": "table", "rows": rows})
            continue
        text_lines.append(lines[index])
        index += 1

    flush_text()
    return blocks or [{"type": "text", "text": ""}]


def blocks_to_markdown(blocks: Sequence[dict]) -> str:
    """Join ordered editor blocks into the document's saved representation."""
    parts = []
    for block in blocks:
        if block.get("type") == "table":
            value = table_rows_to_markdown(block.get("rows", []))
        else:
            value = str(block.get("text", "")).strip()
        if value:
            parts.append(value)
    return "\n\n".join(parts)


def _add_table(document: Document, rows: Sequence[Sequence[str]]) -> None:
    width = max((len(row) for row in rows), default=0)
    if not rows or width == 0:
        return
    table = document.add_table(rows=len(rows), cols=width)
    table.style = "Table Grid"
    for row_index, row in enumerate(rows):
        for column_index in range(width):
            value = row[column_index] if column_index < len(row) else ""
            cell = table.cell(row_index, column_index)
            cell.text = value
            if row_index == 0:
                for run in cell.paragraphs[0].runs:
                    run.bold = True


def edited_word_bytes(text: str, source_name: str) -> bytes:
    """Convert edited plain/Markdown content to a new editable Word document."""
    document = Document()
    document.core_properties.title = f"{safe_download_stem(source_name)} 识别修订版"
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")

    index = 0
    while index < len(lines):
        line = lines[index]
        if _looks_like_table_start(lines, index):
            table_rows = [_split_markdown_row(line)]
            index += 2  # Skip the Markdown separator row.
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_rows.append(_split_markdown_row(lines[index]))
                index += 1
            _add_table(document, table_rows)
            continue

        page_match = PAGE_MARKER.match(line.strip())
        heading_match = HEADING.match(line.strip())
        ordered_match = ORDERED_ITEM.match(line)
        if page_match:
            document.add_heading(page_match.group(1), level=1)
        elif heading_match:
            level = min(len(heading_match.group(1)), 6)
            document.add_heading(heading_match.group(2), level=level)
        elif line.lstrip().startswith(("- ", "* ", "+ ")):
            document.add_paragraph(line.lstrip()[2:], style="List Bullet")
        elif ordered_match:
            document.add_paragraph(ordered_match.group(1), style="List Number")
        else:
            document.add_paragraph(line)
        index += 1

    output = BytesIO()
    document.save(output)
    return output.getvalue()
