"""JSON bridge to supplied parsers with documents and runtime kept private.

The original Streamlit/HTTP application entry points are never launched here.
"""
from __future__ import annotations

import ast
import base64
import contextlib
import importlib
import io
import json
import os
from pathlib import Path
import sys
import time
from decimal import Decimal

PROJECT = Path(__file__).resolve().parent.parent
LEGACY_OCR = PROJECT / "legacy" / "ocr"
LEGACY_COMPARE = PROJECT / "legacy" / "compare"
sys.path[:0] = [str(LEGACY_OCR), str(LEGACY_COMPARE)]
sys.dont_write_bytecode = True
import runtime_paths

PROTOCOL = sys.stdout


def project_path(value: str) -> Path:
    target = runtime_paths.private_path(value, "Document path")
    if runtime_paths.data_directory() not in target.parents:
        raise ValueError("Document files must remain inside VERIFY_DATA_DIR.")
    return target


def paragraph(text) -> dict:
    return {"type": "p", "runs": [{"text": str(text or "")}]}


def blocks_to_units(blocks) -> list:
    units = []
    for block in blocks:
        if block.get("type") == "table":
            units.append({"type": "table", "rows": [
                [{"paras": [paragraph(cell)]} for cell in row]
                for row in block.get("rows", [])
            ]})
        else:
            units.extend(text_units(block.get("text", "")))
    return units


def text_units(text) -> list:
    return [paragraph(line) for line in str(text).splitlines()]


def extraction_blocks(text, tables, markdown=None) -> list:
    if markdown:
        return importlib.import_module("editable_output").markdown_to_blocks(markdown)
    blocks = [{"type": "text", "text": text}] if text else []
    blocks.extend({"type": "table", "rows": rows} for rows in tables if rows)
    return blocks


def extract_image_document(image):
    """Choose one OCR provider explicitly; HTTP failures never load a model."""
    mode = os.environ.get("VERIFY_OCR_MODE", "disabled").strip().lower()
    if mode == "disabled":
        raise RuntimeError(
            "Image and scanned-PDF OCR is disabled. Native PDF, DOCX and spreadsheet "
            "text extraction is available. Configure local OCR with offline models, "
            "or explicitly allow the configured HTTP OCR service."
        )
    if mode == "http":
        if not os.environ.get("VERIFY_OCR_URL", "").strip():
            raise RuntimeError("VERIFY_OCR_URL is required when VERIFY_OCR_MODE=http.")
        # The remote client also supports an older environment variable;
        # only the URL explicitly passed by the launcher may select a service.
        os.environ["DOCUMENT_OCR_URL"] = os.environ["VERIFY_OCR_URL"]
        return importlib.import_module("remote_ocr").extract_image_document(image)
    if mode == "local":
        runtime_paths.private_model_directory()
        return importlib.import_module("ocr_engine").extract_image_document(image)
    raise ValueError("VERIFY_OCR_MODE must be disabled, local or http.")


def render_pdf_page(document, index):
    """Render only the current page and release the intermediate pixmap."""
    import fitz
    from PIL import Image

    if index >= len(document):
        raise ValueError("The scanned PDF page could not be rendered.")
    pdf_page = document.load_page(index)
    scale = 220 / 72
    max_pixels = int(os.environ.get("VERIFY_OCR_MAX_PIXELS", "12000000"))
    if not 0 < max_pixels <= 12000000:
        raise ValueError("VERIFY_OCR_MAX_PIXELS must be between 1 and 12000000.")
    width = int(pdf_page.rect.width * scale + 1)
    height = int(pdf_page.rect.height * scale + 1)
    if width * height > max_pixels:
        raise ValueError("The scanned PDF page exceeds the OCR image pixel limit.")
    pixmap = pdf_page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
    try:
        return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    finally:
        del pixmap
        del pdf_page


_docx_functions = None


def docx_functions():
    """Load only reusable definitions from the supplied DUIBI application.

    Exclude HTTP startup, directory creation, cwd changes and OCR imports.
    """
    global _docx_functions
    if _docx_functions is not None:
        return _docx_functions
    source = (LEGACY_COMPARE / "app.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    safe_imports = {"copy", "html", "io", "json", "re", "zipfile", "xml", "pathlib", "typing", "collections", "decimal", "unicodedata"}
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            names = [name for name in node.names if name.name.split(".")[0] in safe_imports]
            if names:
                nodes.append(ast.Import(names=names))
        elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] in safe_imports:
            nodes.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name not in {"main", "_ensure_ocr_cwd"}:
            nodes.append(node)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            try:
                ast.literal_eval(node.value)
            except (ValueError, TypeError):
                continue
            nodes.append(node)
    namespace = {"__name__": "legacy_docx_functions", "__file__": str(LEGACY_COMPARE / "app.py")}
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(module, str(LEGACY_COMPARE / "app.py"), "exec"), namespace)
    namespace["NS"] = {"w": namespace["W"]}
    if "parse_docx" not in namespace:
        raise ValueError("The supplied comparison module has no DOCX parser.")
    _docx_functions = namespace
    return namespace


def apply_profile(blocks, profile):
    if profile == "generic":
        return blocks, []
    if profile != "auto_parts_warehouse":
        raise ValueError("Unknown document rule profile.")
    return importlib.import_module("business_rules").apply_rules_to_blocks(
        blocks, "auto_parts_export", "warehouse"
    )


def parse_document(input_data):
    file_path = project_path(input_data["path"])
    filename = str(input_data["filename"])
    extension = Path(filename).suffix.lower()
    if extension in {".docx", ".xlsx", ".doc"}:
        import zipfile
        if zipfile.is_zipfile(file_path):
            with zipfile.ZipFile(file_path) as archive:
                entries = archive.infolist()
                if len(entries) > 2000 or sum(entry.file_size for entry in entries) > 100 * 1024 * 1024:
                    raise ValueError("The expanded Office document exceeds the supported size.")
    profile = input_data.get("profile", "generic")
    if profile != "generic":
        # Reject an unavailable private profile even when a document is empty.
        apply_profile([], profile)
    started = time.monotonic()
    pages = []

    def page(label, method, blocks, confidence=None, quality=None):
        original_units = blocks_to_units(blocks)
        corrected, changes = apply_profile(blocks, profile)
        pages.append({"label": label, "method": method, "confidence": confidence,
                      "quality": quality, "original_units": original_units,
                      "units": blocks_to_units(corrected), "rule_changes": changes})

    if extension in {".txt", ".md"}:
        data = file_path.read_bytes()
        decoded = None
        for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5"):
            try:
                decoded = data.decode(encoding)
                break
            except UnicodeError:
                continue
        if decoded is None:
            raise ValueError("The text encoding is not supported.")
        blocks = importlib.import_module("editable_output").markdown_to_blocks(decoded) if extension == ".md" else [{"type": "text", "text": decoded}]
        page("Document", "native_text", blocks)
    elif extension == ".docx":
        units = docx_functions()["parse_docx"](file_path)
        corrected, changes = apply_profile(units_to_blocks(units), profile)
        pages.append({"label": "Document", "method": "native_docx", "confidence": None,
                      "quality": None, "original_units": units, "units": blocks_to_units(corrected) if changes else units, "rule_changes": changes})
    elif extension == ".doc":
        result = importlib.import_module("word_parser").extract_word_document(str(file_path))
        page("Document", result.method, extraction_blocks(result.text, result.tables, result.markdown), quality=result.integrity_score)
    elif extension in {".xls", ".xlsx", ".csv"}:
        result = importlib.import_module("spreadsheet_parser").extract_spreadsheet_document(file_path.read_bytes(), filename)
        for sheet in result.sheets:
            page(sheet.name, result.method, [{"type": "table", "rows": sheet.rows}])
    elif extension in {".png", ".jpg", ".jpeg"}:
        image = importlib.import_module("file_utils").load_image_file(str(file_path))
        if image is None:
            raise ValueError("The uploaded image could not be loaded.")
        try:
            result = extract_image_document(image)
            page("Image", result.method, extraction_blocks(result.text, [result.table], result.markdown), confidence=result.confidence)
        finally:
            image.close()
    elif extension == ".pdf":
        native = importlib.import_module("native_pdf").extract_native_pdf(str(file_path), header_keywords=("PN", "数量", "零件", "Qty", "Quantity"))
        with contextlib.ExitStack() as resources:
            document = None
            for index, result in enumerate(native):
                if result.method == "native_pdf":
                    page(f"Page {index + 1}", result.method, extraction_blocks(result.text, result.tables, result.markdown), quality=result.quality_score)
                else:
                    if document is None:
                        document = resources.enter_context(importlib.import_module("fitz").open(str(file_path)))
                    image = render_pdf_page(document, index)
                    try:
                        recognized = extract_image_document(image)
                        page(f"Page {index + 1}", recognized.method, extraction_blocks(recognized.text, [recognized.table], recognized.markdown), confidence=recognized.confidence)
                    finally:
                        image.close()
    else:
        raise ValueError("This file format is not supported.")
    units = [unit for current in pages for unit in current["units"]]
    import comparison_adapter
    comparison = comparison_adapter.original
    records = comparison.extract_records(units)
    party = comparison._resolve_party(units)
    order_no = comparison._document_value_any(units, "order_no")
    fields = {"purchase_order": order_no, "supplier": party.get("supplier", ""),
              "part_number": records[0].get("part_no", "") if len(records) == 1 else "",
              "delivered_quantity": records[0].get("quantity") if len(records) == 1 else None}
    uncertain = any(current["confidence"] is not None and current["confidence"] < .85 for current in pages)
    return {"filename": filename, "pages": pages, "units": units, "records": records,
            "party": party, "fields": fields, "needs_confirmation": uncertain or len(records) != 1 or any(r.get("needs_review") for r in records),
            "elapsed_seconds": round(time.monotonic() - started, 3), "profile": profile}


def units_to_blocks(units):
    def ptext(p):
        return "".join(str(run.get("text", "")) for run in p.get("runs", []))
    return [{"type": "table", "rows": [["\n".join(ptext(p) for p in cell.get("paras", [])) for cell in row] for row in unit.get("rows", [])]}
            if unit.get("type") == "table" else {"type": "text", "text": ptext(unit)} for unit in units]


def export_document(input_data):
    editable = importlib.import_module("editable_output")
    units = input_data["units"]
    markdown = editable.blocks_to_markdown(units_to_blocks(units))
    fmt = input_data["format"]
    if fmt == "md":
        data = editable.markdown_download_bytes(markdown)
    elif fmt == "txt":
        text = "\n\n".join("\n".join("\t".join(row) for row in block["rows"]) if block["type"] == "table" else block["text"] for block in units_to_blocks(units))
        data = editable.text_download_bytes(text)
    elif fmt == "docx":
        original = project_path(input_data["path"])
        # Existing DOCX rich runs retain the supplied template and styles.
        if original.suffix.lower() == ".docx" and all("rpos" in run for unit in units for p in ([unit] if unit.get("type") == "p" else [p for row in unit.get("rows", []) for cell in row for p in cell.get("paras", [])]) for run in p.get("runs", [])):
            import tempfile
            with tempfile.TemporaryDirectory(dir=runtime_paths.runtime_temp_dir()) as folder:
                output = Path(folder) / "edited.docx"
                docx_functions()["save_docx_from_units"](original, output, units)
                data = output.read_bytes()
        else:
            data = editable.edited_word_bytes(markdown, input_data["filename"])
    else:
        raise ValueError("Choose DOCX, Markdown or TXT export.")
    return {"base64": base64.b64encode(data).decode("ascii"), "format": fmt}


def dispatch(action, input_data):
    runtime_paths.configure_private_environment()
    if action == "parse":
        return parse_document(input_data)
    if action == "compare":
        return importlib.import_module("comparison_adapter").compare_documents(
            input_data["order_units"], input_data["delivery_units"]
        )
    if action == "export":
        return export_document(input_data)
    if action == "status":
        return {"python": sys.version.split()[0], "project": str(PROJECT), "dependencies": {name: importlib.util.find_spec(name) is not None for name in ("paddleocr", "paddle", "cv2", "docx", "pdfplumber", "fitz", "openpyxl", "xlrd")}}
    raise ValueError("Unsupported local processing action.")


def main():
    for request_line in sys.stdin:
        request = {}
        try:
            request = json.loads(request_line)
            # Keep parser messages out of the structured stdout protocol.
            with contextlib.redirect_stdout(sys.stderr):
                result = dispatch(request["action"], request.get("input", {}))
            response = {"id": request["id"], "ok": True, "result": result}
        except ModuleNotFoundError as error:
            response = {"id": request.get("id"), "ok": False, "error": f"Missing local dependency: {error.name}. Install the supplied project requirements inside the project runtime."}
        except Exception as error:
            response = {"id": request.get("id"), "ok": False, "error": f"Local document processing failed: {error}"}
        PROTOCOL.write("@@VERIFY_JSON@@" + json.dumps(response, ensure_ascii=False, default=lambda value: str(value) if isinstance(value, Decimal) else str(value)) + "\n")
        PROTOCOL.flush()


if __name__ == "__main__":
    main()
