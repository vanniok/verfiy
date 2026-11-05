"""PaddleOCR fallback for images and scanned PDF pages."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from typing import Any, List, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps

from runtime_paths import configure_private_environment, private_model_directory, private_path


@dataclass
class ImageExtraction:
    text: str
    table: List[List[str]]
    markdown: str
    method: str
    confidence: float
    table_bbox: Tuple[int, int, int, int] | None = None


@lru_cache(maxsize=1)
def get_ocr_engine():
    configure_private_environment()
    models = private_model_directory()
    model_directories = {
        "det_model_dir": models / "whl" / "det" / "ch" / "ch_PP-OCRv4_det_infer",
        "rec_model_dir": models / "whl" / "rec" / "ch" / "ch_PP-OCRv4_rec_infer",
        "cls_model_dir": models / "whl" / "cls" / "ch_ppocr_mobile_v2.0_cls_infer",
    }
    for name, folder in model_directories.items():
        folder = private_path(folder, name)
        if models not in folder.parents:
            raise RuntimeError(f"{name} must remain inside VERIFY_MODEL_DIR.")
        required = ("inference.pdmodel", "inference.pdiparams")
        if not folder.is_dir() or any(not private_path(folder / filename, name).is_file() for filename in required):
            raise RuntimeError(
                f"Offline OCR model files are missing from {folder}. "
                "Provide all three models under VERIFY_MODEL_DIR/whl; no models are downloaded."
            )
        model_directories[name] = folder.relative_to(models).as_posix()
    # Paddle 2.6 on Windows cannot open Chinese absolute model paths. The
    # configured private model root is the only cwd used for local models;
    # the three validated whl paths remain ASCII and never use the code tree.
    os.chdir(models)
    try:
        from paddleocr import PaddleOCR

        return PaddleOCR(
            use_angle_cls=True,
            lang="ch",
            **model_directories,
            det_db_thresh=0.25,
            det_db_box_thresh=0.5,
            drop_score=0.35,
            show_log=False,
        )
    except Exception as exc:
        raise RuntimeError(f"PaddleOCR 初始化失败：{exc}") from exc


def _prepare(image: Image.Image) -> np.ndarray:
    """Conservative preprocessing: preserve decimal points and thin strokes."""
    rgb = image.convert("RGB")
    gray = ImageOps.grayscale(rgb)
    gray = ImageOps.autocontrast(gray, cutoff=0.5)
    gray = ImageEnhance.Sharpness(gray).enhance(1.35)
    return np.asarray(gray.convert("RGB"))


def _legacy_lines(result) -> List[Tuple[Any, str, float]]:
    if not result:
        return []
    page = result[0] if len(result) == 1 and isinstance(result[0], list) else result
    lines = []
    for item in page or []:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        box, recognition = item
        if isinstance(recognition, (list, tuple)) and recognition:
            text = str(recognition[0]).strip()
            score = float(recognition[1]) if len(recognition) > 1 else 0.0
            if text:
                lines.append((box, text, score))
    return lines


def ocr_image_with_bbox(image: Image.Image) -> List[Tuple[Any, str, float]]:
    engine = get_ocr_engine()
    result = engine.ocr(_prepare(image), cls=True)
    lines = _legacy_lines(result)
    lines.sort(
        key=lambda item: (
            min(point[1] for point in item[0]),
            min(point[0] for point in item[0]),
        )
    )
    return lines


def ocr_image(image: Image.Image) -> str:
    return "\n".join(text for _, text, _ in ocr_image_with_bbox(image))


def reconstruct_rows(
    items: Sequence[Tuple[Any, str, float]], y_tolerance: float = 0.55
) -> List[List[str]]:
    boxes = []
    for box, text, score in items:
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        boxes.append(
            {
                "text": text,
                "x": min(xs),
                "cy": (min(ys) + max(ys)) / 2,
                "height": max(ys) - min(ys),
            }
        )
    if not boxes:
        return []
    median_height = float(np.median([box["height"] for box in boxes]))
    boxes.sort(key=lambda box: (box["cy"], box["x"]))
    rows: List[List[dict]] = []
    for box in boxes:
        if not rows:
            rows.append([box])
            continue
        row_center = float(np.mean([member["cy"] for member in rows[-1]]))
        if abs(box["cy"] - row_center) <= median_height * y_tolerance:
            rows[-1].append(box)
        else:
            rows.append([box])
    return [
        [box["text"] for box in sorted(row, key=lambda box: box["x"])]
        for row in rows
    ]


def _merge_positions(values, gap: int = 4) -> List[int]:
    groups: List[List[int]] = []
    for value in map(int, values):
        if not groups or value - groups[-1][-1] > gap:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [round(sum(group) / len(group)) for group in groups]


def detect_ruled_table(
    image: Image.Image,
) -> Tuple[List[int], List[int]] | None:
    """
    Return the column and row boundary coordinates of the main rectangular grid.
    Only the consecutive section with stable vertical separators is selected, so
    merged remark/total rows below the product table do not corrupt its columns.
    """
    gray = np.asarray(image.convert("L"))
    binary = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )[1]
    height, width = binary.shape

    horizontal = cv2.morphologyEx(
        binary,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (max(30, width // 12), 1)),
    )
    vertical = cv2.morphologyEx(
        binary,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, height // 25))),
    )
    y_values = np.where((horizontal > 0).sum(axis=1) > width * 0.25)[0]
    x_values = np.where((vertical > 0).sum(axis=0) > height * 0.15)[0]
    ys = _merge_positions(y_values)
    xs = _merge_positions(x_values)
    if len(xs) < 4 or len(ys) < 3:
        return None

    good_intervals = []
    for index, (top, bottom) in enumerate(zip(ys, ys[1:])):
        if bottom - top < 12:
            continue
        crossing = 0
        inner_top, inner_bottom = top + 3, bottom - 3
        for x in xs:
            strip = vertical[inner_top:inner_bottom, max(0, x - 2) : x + 3]
            if strip.size and np.count_nonzero(strip) / strip.size > 0.16:
                crossing += 1
        if crossing >= max(4, len(xs) - 1):
            good_intervals.append(index)

    # Find the longest consecutive run: header + product rows.
    runs: List[List[int]] = []
    for index in good_intervals:
        if not runs or index != runs[-1][-1] + 1:
            runs.append([index])
        else:
            runs[-1].append(index)
    if not runs:
        return None
    run = max(runs, key=len)
    if len(run) < 2:
        return None
    selected_ys = ys[run[0] : run[-1] + 2]
    return xs, selected_ys


def _box_metrics(box) -> Tuple[float, float, float]:
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return (sum(xs) / len(xs), sum(ys) / len(ys), max(ys) - min(ys))


def _join_cell_tokens(tokens: Sequence[Tuple[Any, str, float]]) -> str:
    if not tokens:
        return ""
    enriched = []
    for box, text, score in tokens:
        center_x, center_y, height = _box_metrics(box)
        enriched.append((center_y, center_x, height, text))
    enriched.sort()
    median_height = float(np.median([item[2] for item in enriched]))
    lines: List[List[Tuple[float, str]]] = []
    line_centers: List[float] = []
    for center_y, center_x, height, text in enriched:
        target = None
        for index, line_y in enumerate(line_centers):
            if abs(center_y - line_y) <= max(4, median_height * 0.55):
                target = index
                break
        if target is None:
            lines.append([(center_x, text)])
            line_centers.append(center_y)
        else:
            lines[target].append((center_x, text))
            line_centers[target] = float(
                np.mean(
                    [
                        _box_metrics(token[0])[1]
                        for token in tokens
                        if abs(_box_metrics(token[0])[1] - center_y)
                        <= max(4, median_height * 0.55)
                    ]
                    or [center_y]
                )
            )
    return "\n".join(
        " ".join(text for _, text in sorted(line, key=lambda item: item[0]))
        for line in lines
    ).strip()


def table_to_markdown(rows: Sequence[Sequence[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)

    def format_row(row) -> str:
        values = []
        for value in row:
            clean = str(value).replace("|", r"\|").replace("\n", "<br>")
            values.append(clean)
        values += [""] * (width - len(values))
        return "| " + " | ".join(values) + " |"

    return "\n".join(
        [format_row(rows[0]), "| " + " | ".join(["---"] * width) + " |"]
        + [format_row(row) for row in rows[1:]]
    )


def extract_image_document(image: Image.Image) -> ImageExtraction:
    """OCR once, then place recognised boxes into detected grid cells."""
    items = ocr_image_with_bbox(image)
    confidence = float(np.mean([score for _, _, score in items])) if items else 0.0
    grid = detect_ruled_table(image)
    if grid is None:
        rows = reconstruct_rows(items)
        text = "\n".join(" ".join(row) for row in rows)
        return ImageExtraction(text, [], text, "image_text_ocr", confidence)

    xs, ys = grid
    cells: List[List[List[Tuple[Any, str, float]]]] = [
        [[] for _ in range(len(xs) - 1)] for _ in range(len(ys) - 1)
    ]
    outside = []
    left, right, top, bottom = xs[0], xs[-1], ys[0], ys[-1]
    for item in items:
        center_x, center_y, _ = _box_metrics(item[0])
        if left <= center_x <= right and top <= center_y <= bottom:
            row_index = next(
                (i for i in range(len(ys) - 1) if ys[i] <= center_y <= ys[i + 1]),
                None,
            )
            column_index = next(
                (i for i in range(len(xs) - 1) if xs[i] <= center_x <= xs[i + 1]),
                None,
            )
            if row_index is not None and column_index is not None:
                cells[row_index][column_index].append(item)
        else:
            outside.append(item)

    # Keep OCR structural and source-faithful. Optional industry/department
    # corrections are applied later by business_rules.py.
    table = [[_join_cell_tokens(cell) for cell in row] for row in cells]

    outside_rows = reconstruct_rows(outside)
    outside_text = "\n".join(" ".join(row) for row in outside_rows)
    markdown_table = table_to_markdown(table)
    markdown = "\n\n".join(part for part in [outside_text, markdown_table] if part)
    return ImageExtraction(
        text=outside_text,
        table=table,
        markdown=markdown,
        method="image_grid_ocr",
        confidence=confidence,
        table_bbox=(left, top, right, bottom),
    )
