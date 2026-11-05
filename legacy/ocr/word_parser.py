"""Lossless text/table extraction for DOCX and OOXML files named .doc."""

from __future__ import annotations

from dataclasses import dataclass
import html
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import List
import zipfile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.table import Table
from docx.text.paragraph import Paragraph

from native_pdf import table_to_markdown
from runtime_paths import runtime_temp_dir


@dataclass
class WordExtraction:
    text: str
    tables: List[List[List[str]]]
    markdown: str
    method: str
    integrity_score: float
    paragraph_count: int
    preview_html: str


def _is_ooxml(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as archive:
            return "word/document.xml" in archive.namelist()
    except (OSError, zipfile.BadZipFile):
        return False


def _convert_legacy_doc(path: str, output_dir: str) -> str:
    """Convert a true binary .doc when LibreOffice is available."""
    office = shutil.which("soffice") or shutil.which("libreoffice")
    if not office:
        raise RuntimeError(
            "该文件是真正的旧版二进制 DOC，当前机器没有 LibreOffice。"
            "请安装 LibreOffice，或先用 Word 另存为 DOCX。"
        )
    temporary_root = runtime_temp_dir().resolve()
    profile_dir = temporary_root / "libreoffice_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment["TEMP"] = str(temporary_root)
    environment["TMP"] = str(temporary_root)
    completed = subprocess.run(
        [
            office,
            "--headless",
            f"-env:UserInstallation={profile_dir.as_uri()}",
            "--convert-to",
            "docx",
            "--outdir",
            output_dir,
            str(Path(path).resolve()),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=environment,
    )
    converted = Path(output_dir) / f"{Path(path).stem}.docx"
    if completed.returncode != 0 or not converted.exists():
        raise RuntimeError(
            "旧版 DOC 转换失败：" + (completed.stderr or completed.stdout).strip()
        )
    return str(converted)


def _clean_cell(cell) -> str:
    return "\n".join(
        paragraph.text.strip()
        for paragraph in cell.paragraphs
        if paragraph.text.strip()
    )


def _paragraph_markdown(paragraph: Paragraph) -> str:
    text = paragraph.text.strip()
    if not text:
        return ""
    style = (paragraph.style.name if paragraph.style else "").lower()
    if style.startswith("heading"):
        try:
            level = max(1, min(6, int(style.split()[-1])))
        except ValueError:
            level = 2
        return f"{'#' * level} {text}"
    return text


def _run_html(run) -> str:
    text = html.escape(run.text).replace("\t", "&emsp;&emsp;").replace("\n", "<br>")
    if not text:
        return ""
    styles = []
    if run.bold:
        styles.append("font-weight:700")
    if run.italic:
        styles.append("font-style:italic")
    if run.underline:
        styles.append("text-decoration:underline")
    if run.font.size:
        size = max(8, min(36, run.font.size.pt))
        styles.append(f"font-size:{size:.1f}pt")
    if run.font.color and run.font.color.rgb:
        styles.append(f"color:#{run.font.color.rgb}")
    style = f' style="{";".join(styles)}"' if styles else ""
    return f"<span{style}>{text}</span>"


def _paragraph_preview_html(paragraph: Paragraph) -> str:
    if not paragraph.text and not paragraph.runs:
        return '<div class="word-paragraph blank">&nbsp;</div>'
    alignment = {
        WD_ALIGN_PARAGRAPH.CENTER: "center",
        WD_ALIGN_PARAGRAPH.RIGHT: "right",
        WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
    }.get(paragraph.alignment, "left")
    paragraph_styles = [f"text-align:{alignment}"]
    if paragraph.paragraph_format.left_indent:
        paragraph_styles.append(
            f"margin-left:{paragraph.paragraph_format.left_indent.pt:.1f}pt"
        )
    if paragraph.paragraph_format.first_line_indent:
        paragraph_styles.append(
            f"text-indent:{paragraph.paragraph_format.first_line_indent.pt:.1f}pt"
        )
    content = "".join(_run_html(run) for run in paragraph.runs)
    if not content:
        content = html.escape(paragraph.text)
    return (
        f'<div class="word-paragraph" style="{";".join(paragraph_styles)}">'
        f"{content}</div>"
    )


def _table_preview_html(table: Table) -> str:
    rows = []
    for row in table.rows:
        cells = "".join(
            f"<td>{html.escape(_clean_cell(cell)).replace(chr(10), '<br>')}</td>"
            for cell in row.cells
        )
        rows.append(f"<tr>{cells}</tr>")
    return '<table class="word-table">' + "".join(rows) + "</table>"


def _wrap_preview_html(blocks: List[str]) -> str:
    return f"""
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ margin:0; padding:14px; background:#e9edf2; color:#111; }}
  .word-page {{
    box-sizing:border-box; width:100%; min-height:780px; margin:0 auto;
    padding:48px 52px; background:#fff; border:1px solid #d6d9de;
    box-shadow:0 2px 8px rgba(0,0,0,.08);
    font-family:"SimSun","宋体","Microsoft YaHei",sans-serif;
    font-size:11pt; line-height:1.45;
  }}
  .word-paragraph {{ min-height:1.45em; margin:0 0 6px 0; white-space:pre-wrap; }}
  .word-paragraph.blank {{ margin-bottom:3px; }}
  .word-table {{ width:100%; border-collapse:collapse; margin:8px 0 12px; }}
  .word-table td {{ border:1px solid #333; padding:5px 7px; vertical-align:middle; }}
</style>
</head>
<body><div class="word-page">{''.join(blocks)}</div></body>
</html>
"""


def _extract_ooxml(path: str, method: str) -> WordExtraction:
    document = Document(path)
    text_blocks: List[str] = []
    markdown_blocks: List[str] = []
    tables: List[List[List[str]]] = []
    preview_blocks: List[str] = []
    paragraph_count = 0

    # Preserve the source order of paragraphs and tables.
    for child in document.element.body.iterchildren():
        if child.tag.endswith("}p"):
            paragraph = Paragraph(child, document)
            paragraph_count += 1
            text_blocks.append(paragraph.text)
            preview_blocks.append(_paragraph_preview_html(paragraph))
            markdown = _paragraph_markdown(paragraph)
            if markdown:
                markdown_blocks.append(markdown)
        elif child.tag.endswith("}tbl"):
            table = Table(child, document)
            preview_blocks.append(_table_preview_html(table))
            rows = [[_clean_cell(cell) for cell in row.cells] for row in table.rows]
            if rows:
                tables.append(rows)
                text_blocks.extend("\t".join(row) for row in rows)
                markdown_blocks.append(table_to_markdown(rows))

    text = "\n".join(text_blocks).strip()
    useful = [character for character in text if not character.isspace()]
    intact = sum(character != "\ufffd" and character.isprintable() for character in useful)
    integrity = intact / max(len(useful), 1)
    return WordExtraction(
        text=text,
        tables=tables,
        markdown="\n\n".join(markdown_blocks),
        method=method,
        integrity_score=integrity,
        paragraph_count=paragraph_count,
        preview_html=_wrap_preview_html(preview_blocks),
    )


def extract_word_document(path: str) -> WordExtraction:
    # Some systems save OOXML content with a .doc suffix. Detect by signature,
    # not by extension; the supplied 1.doc is this type.
    if _is_ooxml(path):
        return _extract_ooxml(path, "word_ooxml")
    with tempfile.TemporaryDirectory(
        prefix="word_convert_", dir=runtime_temp_dir()
    ) as output_dir:
        converted = _convert_legacy_doc(path, output_dir)
        return _extract_ooxml(converted, "word_legacy_converted")
