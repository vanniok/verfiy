"""Native XLS/XLSX/CSV extraction without OCR."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, time
from html import escape
from io import BytesIO, StringIO
import math
from pathlib import Path
from typing import Iterable, Sequence


@dataclass(frozen=True)
class SpreadsheetSheet:
    name: str
    rows: list[list[str]]
    preview_html: str
    row_count: int
    column_count: int
    preview_truncated: bool = False


@dataclass(frozen=True)
class SpreadsheetExtraction:
    method: str
    sheets: list[SpreadsheetSheet]
    encoding: str | None = None


class SpreadsheetParseError(RuntimeError):
    pass


MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_WORKSHEETS = 20
MAX_ROWS_PER_SHEET = 10_000
MAX_COLUMNS_PER_SHEET = 200
MAX_EDITABLE_CELLS = 50_000
MAX_TOTAL_EDITABLE_CELLS = 100_000


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        if value.is_integer():
            return str(int(value))
        return format(value, ".15g")
    return str(value)


def _trim_rows(
    values: Iterable[Sequence[object]], sheet_name: str = "当前工作表"
) -> list[list[str]]:
    rows: list[list[str]] = []
    widest = 0
    for row_number, row in enumerate(values, start=1):
        if row_number > MAX_ROWS_PER_SHEET:
            raise SpreadsheetParseError(
                f"工作表“{sheet_name}”超过 {MAX_ROWS_PER_SHEET:,} 行，"
                "请拆分后再上传。"
            )
        converted = [_cell_text(value) for value in row]
        if len(converted) > MAX_COLUMNS_PER_SHEET:
            raise SpreadsheetParseError(
                f"工作表“{sheet_name}”超过 {MAX_COLUMNS_PER_SHEET:,} 列，"
                "请拆分后再上传。"
            )
        widest = max(widest, len(converted))
        if row_number * widest > MAX_EDITABLE_CELLS:
            raise SpreadsheetParseError(
                f"工作表“{sheet_name}”超过单次可编辑上限 "
                f"{MAX_EDITABLE_CELLS:,} 个单元格，请拆分后再上传。"
            )
        rows.append(converted)
    while rows and not any(cell.strip() for cell in rows[-1]):
        rows.pop()
    if not rows:
        return []
    last_column = max(
        (
            index
            for row in rows
            for index, cell in enumerate(row)
            if cell.strip()
        ),
        default=-1,
    )
    if last_column < 0:
        return []
    width = last_column + 1
    return [row[:width] + [""] * max(0, width - len(row)) for row in rows]


def _preview_html(
    rows: Sequence[Sequence[str]], max_rows: int = 200, max_columns: int = 50
) -> tuple[str, bool]:
    shown = list(rows[:max_rows])
    truncated = len(rows) > max_rows or any(len(row) > max_columns for row in rows)
    body_rows = []
    for row_index, row in enumerate(shown):
        cells = []
        tag = "th" if row_index == 0 else "td"
        for value in row[:max_columns]:
            safe = escape(str(value)).replace("\n", "<br>")
            cells.append(f"<{tag}>{safe}</{tag}>")
        body_rows.append("<tr>" + "".join(cells) + "</tr>")
    if not body_rows:
        body_rows.append("<tr><td>空工作表</td></tr>")
    notice = (
        '<p class="notice">左侧仅预览前 200 行、50 列；右侧保留完整单元格数据。</p>'
        if truncated
        else ""
    )
    html = f"""
    <style>
      body {{ margin: 0; color: #262730; font-family: 'Microsoft YaHei', sans-serif; }}
      .sheet {{ overflow: auto; max-height: 620px; border: 1px solid #d9dde5; }}
      table {{ border-collapse: collapse; min-width: 100%; font-size: 14px; }}
      th, td {{ border: 1px solid #d9dde5; padding: 6px 8px; text-align: left;
                white-space: pre-wrap; vertical-align: top; }}
      th {{ background: #eef1f6; position: sticky; top: 0; z-index: 1; }}
      .notice {{ color: #7b8190; font-size: 13px; }}
    </style>
    {notice}<div class="sheet"><table>{''.join(body_rows)}</table></div>
    """
    return html, truncated


def _make_sheet(name: str, rows: list[list[str]]) -> SpreadsheetSheet:
    if not rows:
        rows = [[""]]
    width = max((len(row) for row in rows), default=1)
    rows = [row + [""] * (width - len(row)) for row in rows]
    if len(rows) * width > MAX_EDITABLE_CELLS:
        raise SpreadsheetParseError(
            f"工作表“{name}”包含 {len(rows) * width:,} 个单元格，"
            f"超过单次可编辑上限 {MAX_EDITABLE_CELLS:,}；请拆分后再上传。"
        )
    preview_html, truncated = _preview_html(rows)
    return SpreadsheetSheet(
        name=name,
        rows=rows,
        preview_html=preview_html,
        row_count=len(rows),
        column_count=width,
        preview_truncated=truncated,
    )


def _validate_workbook_total(sheets: Sequence[SpreadsheetSheet]) -> None:
    total = sum(sheet.row_count * sheet.column_count for sheet in sheets)
    if total > MAX_TOTAL_EDITABLE_CELLS:
        raise SpreadsheetParseError(
            f"整个工作簿包含 {total:,} 个可编辑单元格，超过总上限 "
            f"{MAX_TOTAL_EDITABLE_CELLS:,}；请拆分后再上传。"
        )


def _parse_xlsx(data: bytes) -> SpreadsheetExtraction:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise SpreadsheetParseError("缺少 XLSX 解析组件 openpyxl。") from exc
    try:
        workbook = load_workbook(BytesIO(data), read_only=True, data_only=False)
        try:
            if len(workbook.worksheets) > MAX_WORKSHEETS:
                raise SpreadsheetParseError(
                    f"工作簿包含 {len(workbook.worksheets)} 个工作表，超过上限 "
                    f"{MAX_WORKSHEETS}；请拆分后再上传。"
                )
            sheets = [
                _make_sheet(
                    worksheet.title,
                    _trim_rows(
                        worksheet.iter_rows(values_only=True), worksheet.title
                    ),
                )
                for worksheet in workbook.worksheets
            ]
            _validate_workbook_total(sheets)
        finally:
            workbook.close()
    except Exception as exc:
        raise SpreadsheetParseError(f"XLSX 文件读取失败：{exc}") from exc
    return SpreadsheetExtraction(method="Excel XLSX 原生单元格解析", sheets=sheets)


def _parse_xls(data: bytes) -> SpreadsheetExtraction:
    try:
        import xlrd
    except ImportError as exc:
        raise SpreadsheetParseError("缺少旧版 XLS 解析组件 xlrd。") from exc
    try:
        workbook = xlrd.open_workbook(file_contents=data, on_demand=True)
        if workbook.nsheets > MAX_WORKSHEETS:
            raise SpreadsheetParseError(
                f"工作簿包含 {workbook.nsheets} 个工作表，超过上限 "
                f"{MAX_WORKSHEETS}；请拆分后再上传。"
            )
        sheets = []
        for worksheet in workbook.sheets():
            if worksheet.nrows > MAX_ROWS_PER_SHEET:
                raise SpreadsheetParseError(
                    f"工作表“{worksheet.name}”超过 {MAX_ROWS_PER_SHEET:,} 行，"
                    "请拆分后再上传。"
                )
            if worksheet.ncols > MAX_COLUMNS_PER_SHEET:
                raise SpreadsheetParseError(
                    f"工作表“{worksheet.name}”超过 {MAX_COLUMNS_PER_SHEET:,} 列，"
                    "请拆分后再上传。"
                )
            if worksheet.nrows * worksheet.ncols > MAX_EDITABLE_CELLS:
                raise SpreadsheetParseError(
                    f"工作表“{worksheet.name}”超过单次可编辑上限 "
                    f"{MAX_EDITABLE_CELLS:,} 个单元格，请拆分后再上传。"
                )
            values = []
            for row_index in range(worksheet.nrows):
                row = []
                for column_index in range(worksheet.ncols):
                    cell = worksheet.cell(row_index, column_index)
                    if cell.ctype == xlrd.XL_CELL_DATE:
                        value = xlrd.xldate_as_datetime(cell.value, workbook.datemode)
                    elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                        value = bool(cell.value)
                    else:
                        value = cell.value
                    row.append(value)
                values.append(row)
            sheets.append(
                _make_sheet(worksheet.name, _trim_rows(values, worksheet.name))
            )
        _validate_workbook_total(sheets)
        workbook.release_resources()
    except Exception as exc:
        raise SpreadsheetParseError(f"XLS 文件读取失败：{exc}") from exc
    return SpreadsheetExtraction(method="Excel XLS 原生单元格解析", sheets=sheets)


def _decode_csv(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise SpreadsheetParseError("CSV 编码无法识别，请另存为 UTF-8 或 GB18030 后重试。")


def _parse_csv(data: bytes, filename: str) -> SpreadsheetExtraction:
    text, encoding = _decode_csv(data)
    try:
        sample = text[:8192]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        sheet_name = Path(filename).stem or "CSV"
        rows = _trim_rows(
            csv.reader(StringIO(text, newline=""), dialect), sheet_name
        )
    except Exception as exc:
        raise SpreadsheetParseError(f"CSV 文件读取失败：{exc}") from exc
    sheet = _make_sheet(Path(filename).stem or "CSV", rows)
    return SpreadsheetExtraction(
        method="CSV 原生字段解析", sheets=[sheet], encoding=encoding
    )


def extract_spreadsheet_document(data: bytes, filename: str) -> SpreadsheetExtraction:
    if len(data) > MAX_INPUT_BYTES:
        raise SpreadsheetParseError(
            f"文件大小超过 {MAX_INPUT_BYTES // (1024 * 1024)} MB，"
            "请拆分后再上传。"
        )
    extension = Path(filename).suffix.lower()
    if extension == ".xlsx":
        return _parse_xlsx(data)
    if extension == ".xls":
        return _parse_xls(data)
    if extension == ".csv":
        return _parse_csv(data, filename)
    raise SpreadsheetParseError(f"不支持的表格文件格式：{extension or '无扩展名'}")
