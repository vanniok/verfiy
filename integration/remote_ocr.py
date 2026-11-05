"""Version 1 OCR HTTP client; also copied to the old UI as remote_ocr_client.py.

This module never imports Paddle and never falls back to a local model. Requests
contain image bytes, so the caller and service need not share filesystems.
"""
from __future__ import annotations

from dataclasses import dataclass
import io
import json
import math
import os
import socket
from typing import Any
from urllib import error, parse, request

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 12_000_000
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class RemoteOCRError(RuntimeError):
    """Recognition/configuration failure that must be surfaced to the caller."""


@dataclass
class ImageExtraction:
    text: str
    table: list[list[str]]
    markdown: str
    method: str
    confidence: float
    table_bbox: tuple[int, int, int, int] | None = None


@dataclass(frozen=True)
class Configuration:
    url: str
    timeout: float
    token: str


def get_configuration() -> Configuration:
    raw_url = (os.environ.get("DOCUMENT_OCR_URL") or os.environ.get("VERIFY_OCR_URL") or "").strip()
    if not raw_url:
        raise RemoteOCRError("OCR service URL is not configured; local model fallback is disabled.")
    try:
        parts = parse.urlsplit(raw_url)
        port = parts.port
    except ValueError as exc:
        raise RemoteOCRError("OCR service URL is invalid.") from exc
    if (
        parts.scheme not in ("http", "https") or not parts.hostname
        or parts.username is not None or parts.password is not None
        or parts.query or parts.fragment or "\\" in raw_url
        or any(ord(char) < 33 for char in raw_url)
        or (port is not None and not 0 < port < 65536)
    ):
        raise RemoteOCRError("OCR service URL must be an absolute HTTP(S) URL without credentials or query parameters.")
    try:
        timeout = float(os.environ.get("DOCUMENT_OCR_TIMEOUT_SECONDS") or os.environ.get("VERIFY_OCR_TIMEOUT_SECONDS") or "180")
    except ValueError as exc:
        raise RemoteOCRError("OCR request timeout is invalid.") from exc
    if not math.isfinite(timeout) or not 1 <= timeout <= 3600:
        raise RemoteOCRError("OCR request timeout must be between 1 and 3600 seconds.")
    token = os.environ.get("DOCUMENT_OCR_API_TOKEN") or os.environ.get("VERIFY_OCR_API_TOKEN") or ""
    if any(ord(char) < 32 or ord(char) > 126 for char in token):
        raise RemoteOCRError("OCR API token must contain printable ASCII characters.")
    return Configuration(raw_url.rstrip("/"), timeout, token)


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _call(endpoint: str, payload: bytes | None = None) -> dict[str, Any]:
    config = get_configuration()
    headers = {"Accept": "application/json"}
    if config.token:
        headers["Authorization"] = "Bearer " + config.token
    if payload is not None:
        headers["Content-Type"] = "image/png"
    req = request.Request(config.url + endpoint, data=payload, headers=headers, method="POST" if payload is not None else "GET")
    # Explicit service URL: do not route loopback through a process-wide proxy.
    opener = request.build_opener(request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(req, timeout=config.timeout) as response:
            if response.headers.get_content_type() != "application/json":
                raise RemoteOCRError("OCR service returned a non-JSON response.")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except error.HTTPError as exc:
        status = exc.code
        if status == 503:
            raise RemoteOCRError("OCR service is busy or unavailable; retry manually after checking its status.") from exc
        if status == 504:
            raise RemoteOCRError("OCR request timed out; an active recognition may still be running. No automatic retry was attempted.") from exc
        if status in (401, 403):
            raise RemoteOCRError("OCR service authentication failed.") from exc
        if status in (301, 302, 303, 307, 308):
            raise RemoteOCRError("OCR service redirects are disabled; configure the final service URL.") from exc
        if status == 413:
            raise RemoteOCRError("OCR image or response exceeds the service size limit.") from exc
        raise RemoteOCRError("OCR service rejected the request (HTTP " + str(status) + ").") from exc
    except (error.URLError, TimeoutError, socket.timeout, OSError) as exc:
        raise RemoteOCRError("OCR service could not complete the request; no automatic retry or local model fallback was attempted.") from exc
    if len(raw) > MAX_RESPONSE_BYTES:
        raise RemoteOCRError("OCR service response exceeds the size limit.")
    try:
        document = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise RemoteOCRError("OCR service returned invalid JSON.") from exc
    if not isinstance(document, dict) or document.get("version") != 1:
        raise RemoteOCRError("OCR service protocol version is not supported.")
    return document


def health() -> dict[str, Any]:
    """Status check without recognizing an image or loading a local model."""
    document = _call("/v1/health")
    if document.get("status") != "ok":
        raise RemoteOCRError("OCR service is unavailable.")
    return document


def _recognize(image, operation: str) -> Any:
    get_configuration()  # Fail before allocating an encoded image if unconfigured.
    width, height = image.size
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise RemoteOCRError("OCR image exceeds the 12 megapixel limit.")
    buffer = io.BytesIO()
    rgb = image.convert("RGB")
    try:
        rgb.save(buffer, format="PNG")
    finally:
        rgb.close()
    payload = buffer.getvalue()
    if len(payload) > MAX_IMAGE_BYTES:
        raise RemoteOCRError("OCR image exceeds the 20 MiB request limit.")
    document = _call("/v1/recognize?operation=" + operation, payload)
    if document.get("operation") != operation or "result" not in document:
        raise RemoteOCRError("OCR service returned an unexpected result envelope.")
    return document["result"]


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise RemoteOCRError("OCR service returned an invalid numeric field.")
    return float(value)


def extract_image_document(image) -> ImageExtraction:
    result = _recognize(image, "extract")
    if not isinstance(result, dict):
        raise RemoteOCRError("OCR service returned invalid extraction fields.")
    strings = ("text", "markdown", "method")
    if any(not isinstance(result.get(key), str) for key in strings):
        raise RemoteOCRError("OCR service returned invalid extraction text.")
    table = result.get("table")
    if not isinstance(table, list) or any(not isinstance(row, list) or any(not isinstance(cell, str) for cell in row) for row in table):
        raise RemoteOCRError("OCR service returned an invalid table.")
    confidence = _number(result.get("confidence"))
    if not 0 <= confidence <= 1:
        raise RemoteOCRError("OCR service returned an invalid confidence.")
    bbox = result.get("table_bbox")
    if bbox is not None:
        if not isinstance(bbox, list) or len(bbox) != 4 or any(isinstance(value, bool) or not isinstance(value, int) for value in bbox):
            raise RemoteOCRError("OCR service returned an invalid table bounding box.")
        bbox = tuple(bbox)
    return ImageExtraction(result["text"], table, result["markdown"], result["method"], confidence, bbox)


def ocr_image_with_bbox(image) -> list[tuple[Any, str, float]]:
    result = _recognize(image, "boxes")
    if not isinstance(result, list):
        raise RemoteOCRError("OCR service returned invalid recognition boxes.")
    lines = []
    for item in result:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise RemoteOCRError("OCR service returned an invalid recognized line.")
        box = item.get("box")
        if not isinstance(box, list) or len(box) != 4:
            raise RemoteOCRError("OCR service returned an invalid recognition box.")
        points = []
        for point in box:
            if not isinstance(point, list) or len(point) != 2:
                raise RemoteOCRError("OCR service returned an invalid recognition point.")
            points.append([_number(point[0]), _number(point[1])])
        score = _number(item.get("confidence"))
        if not 0 <= score <= 1:
            raise RemoteOCRError("OCR service returned an invalid line confidence.")
        lines.append((points, item["text"], score))
    return lines


def ocr_image(image) -> str:
    return "\n".join(text for _, text, _ in ocr_image_with_bbox(image))
