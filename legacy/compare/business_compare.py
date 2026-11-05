from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation
import re
import unicodedata


# 这里只定义订单/送货单核对所需的最小字段。后续客户字段差异只改别名，
# 不需要改文档预览、编辑和保存逻辑。
FIELD_ALIASES = {
    "customer": (
        "客户", "客户名称", "客户单位", "采购方", "采购单位", "买方", "需方",
        "收货方", "收货单位", "订购方",
    ),
    "supplier": (
        "供应商", "供应商名称", "供方", "卖方", "送货方", "送货单位",
        "发货方", "发货单位", "生产厂家", "supplier",
    ),
    "order_no": (
        "关联订单号", "客户订单号", "采购订单号", "订单编号", "订单号",
        "po", "po号", "pono", "p.o.", "p/o", "orderno", "ordernumber",
    ),
    "delivery_no": ("送货单号", "送货单编号", "出库单号", "deliveryno"),
    "delivery_date": ("送货日期", "交货日期", "deliverydate"),
    "part_no": (
        "pn", "p/n", "零件号", "零件编码", "物料代码", "物料编码",
        "物料号", "料号", "产品编号", "产品型号", "客户型号", "规格型号", "型号",
    ),
    "product_name": ("零件名称", "产品名称", "产品名", "物料名称", "品名", "description"),
    "quantity": (
        "数量", "订单数量", "订购数量", "交货数量", "送货数量",
        "实收数量", "qty", "quantity",
    ),
    "unit": ("计量单位", "单位", "unit", "uom"),
}


def _plain(value: object) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip()


def _header_key(value: object) -> str:
    return re.sub(r"[\s:：()（）_\-./\\]+", "", _plain(value)).lower()


def _field_for_header(value: object) -> str | None:
    key = _header_key(value)
    if not key:
        return None
    best: tuple[int, str] | None = None
    for field, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            alias_key = _header_key(alias)
            if key == alias_key or alias_key in key:
                candidate = (len(alias_key), field)
                if best is None or candidate[0] > best[0]:
                    best = candidate
    return best[1] if best else None


def _paragraph_text(paragraph: dict) -> str:
    return "".join(str(run.get("text", "")) for run in paragraph.get("runs", []))


def _cell_text(cell: dict) -> str:
    return "\n".join(
        _paragraph_text(paragraph).strip()
        for paragraph in cell.get("paras", [])
        if _paragraph_text(paragraph).strip()
    ).strip()


def _quantity(value: object) -> Decimal | None:
    text = _plain(value).replace(",", "").replace("，", "")
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return Decimal(match.group(0))
    except InvalidOperation:
        return None


def _extract_labeled_value(text: str, field: str) -> str:
    aliases = sorted(FIELD_ALIASES[field], key=len, reverse=True)
    alias_pattern = "|".join(re.escape(alias) for alias in aliases)
    stop_aliases = [
        alias
        for other_field, values in FIELD_ALIASES.items()
        if other_field != field
        for alias in values
    ]
    stop_pattern = "|".join(re.escape(alias) for alias in sorted(stop_aliases, key=len, reverse=True))
    pattern = rf"(?:{alias_pattern})\s*[:：#]?\s*(.+?)(?=\s+(?:{stop_pattern})\s*[:：#]?|$)"
    match = re.search(pattern, _plain(text), flags=re.IGNORECASE)
    return match.group(1).strip(" ;；,，") if match else ""


def _contains_field_label(text: str, field: str) -> bool:
    normalized = _header_key(text)
    return any(_header_key(alias) in normalized for alias in FIELD_ALIASES[field])


def _document_value(units: list[dict], field: str) -> str:
    for unit in units:
        if unit.get("type") != "p":
            continue
        text = _paragraph_text(unit)
        value = _extract_labeled_value(text, field)
        if value:
            if field in {"order_no", "delivery_no"}:
                token = re.search(r"[A-Za-z0-9][A-Za-z0-9._/\-]*", value)
                return token.group(0) if token else value
            return value
    return ""


def _document_value_from_tables(units: list[dict], field: str) -> str:
    """Find labeled customer/supplier values inside table cells.

    Supports both ``供应商：XXX`` inside one cell and the two-cell form
    ``| 供应商 | 宁波ABC有限公司 |``.
    """
    aliases = sorted(FIELD_ALIASES[field], key=len, reverse=True)
    alias_pattern = "|".join(re.escape(alias) for alias in aliases)
    for unit in units:
        if unit.get("type") != "table":
            continue
        for row in unit.get("rows", []):
            texts = [_cell_text(cell) for cell in row]
            for index, text in enumerate(texts):
                match = re.search(
                    rf"(?:{alias_pattern})\s*[:：#]?\s*(.+)$",
                    _plain(text),
                    flags=re.IGNORECASE,
                )
                if match:
                    value = match.group(1).strip(" ;；,，")
                    if value:
                        return value
                key = _header_key(text)
                for alias in aliases:
                    if key == _header_key(alias):
                        for nxt in texts[index + 1 :]:
                            if nxt.strip():
                                return nxt.strip()
    return ""


def _document_value_any(units: list[dict], field: str) -> str:
    value = _document_value(units, field)
    if value:
        return value
    return _document_value_from_tables(units, field)


COMPANY_PATTERNS = [
    r"[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,40}?有限责任公司",
    r"[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,40}?股份有限公司",
    r"[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,40}?有限公司",
    r"[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,40}?(?:制造厂|机械厂|工厂)",
    r"[\u4e00-\u9fff]{2,6}公司",
    r"[A-Za-z0-9&.,' \-]{3,60}?(?:Co\.,?\s*Ltd\.?|Ltd\.?)",
]


def _company_candidates(units: list[dict]) -> list[str]:
    """Unlabelled company-name candidates (header-only, role undetermined)."""
    found: list[str] = []
    seen: set[str] = set()
    for unit in units:
        if unit.get("type") == "p":
            texts = [_paragraph_text(unit)]
        elif unit.get("type") == "table":
            texts = [
                _cell_text(cell) for row in unit.get("rows", []) for cell in row
            ]
        else:
            continue
        for text in texts:
            plain = _plain(text)
            for pattern in COMPANY_PATTERNS:
                for match in re.finditer(pattern, plain):
                    name = match.group(0).strip(" :：#，,；;")
                    if len(name) < 2 or name in seen:
                        continue
                    seen.add(name)
                    found.append(name)
    return found


def _resolve_party(units: list[dict]) -> dict:
    customer = _document_value_any(units, "customer")
    supplier = _document_value_any(units, "supplier")
    explicit = [name for name in (_plain(customer), _plain(supplier)) if name]
    raw = _company_candidates(units)
    candidates: list[str] = []
    for name in raw:
        if name in explicit:
            continue
        # Drop substrings of explicit parties or of other candidates
        # (e.g. "机械有限公司" is a substring of "某某机械有限公司").
        if any(name in other for other in raw + explicit if other != name):
            continue
        candidates.append(name)
    return {
        "customer": customer,
        "supplier": supplier,
        "candidates": candidates,
        "review_required": (not customer and not supplier) and bool(candidates),
    }


def _records_from_table(unit: dict, fallback_order_no: str, table_number: int) -> list[dict]:
    rows = [[_cell_text(cell) for cell in row] for row in unit.get("rows", [])]
    if not rows:
        return []

    header_index = -1
    mapping: dict[str, int] = {}
    best_score = 0
    for index, row in enumerate(rows[:12]):
        candidate: dict[str, int] = {}
        for column, value in enumerate(row):
            field = _field_for_header(value)
            if field and field not in candidate:
                candidate[field] = column
        relevant = {"part_no", "product_name", "quantity", "unit"} & set(candidate)
        score = sum(2 if field in {"part_no", "quantity"} else 1 for field in relevant)
        if relevant and score > best_score:
            header_index = index
            mapping = candidate
            best_score = score
    if header_index < 0:
        nonempty_rows = [row for row in rows if any(cell.strip() for cell in row)]
        if len(nonempty_rows) >= 2 and max((len(row) for row in nonempty_rows), default=0) >= 2:
            preview = " | ".join(cell for cell in nonempty_rows[0] if cell)[:160]
            return [{
                "order_no": fallback_order_no,
                "part_no": "",
                "product_name": preview,
                "quantity": None,
                "unit": "",
                "source": f"表格{table_number}",
                "needs_review": True,
                "review_reason": "未识别到PN或数量表头",
            }]
        return []

    records = []
    for row_number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        def value(field: str) -> str:
            column = mapping.get(field)
            return row[column].strip() if column is not None and column < len(row) else ""

        part_no = value("part_no")
        product_name = value("product_name")
        quantity = _quantity(value("quantity"))
        if not any(cell.strip() for cell in row):
            continue
        if not part_no and quantity is None and not product_name:
            continue
        missing = []
        if not part_no:
            missing.append("PN")
        if quantity is None:
            missing.append("数量")
        records.append(
            {
                "order_no": value("order_no") or fallback_order_no,
                "part_no": part_no,
                "product_name": product_name,
                "quantity": quantity,
                "unit": value("unit"),
                "source": f"表格{table_number}第{row_number}行",
                "needs_review": bool(missing),
                "review_reason": f"未识别{'、'.join(missing)}" if missing else "",
            }
        )
    return records


def _records_from_paragraphs(units: list[dict], fallback_order_no: str) -> list[dict]:
    records = []
    for index, unit in enumerate(units, start=1):
        if unit.get("type") != "p":
            continue
        text = _paragraph_text(unit)
        if not any(_contains_field_label(text, field) for field in ("part_no", "product_name", "quantity")):
            continue
        part_no = _extract_labeled_value(text, "part_no")
        product_name = _extract_labeled_value(text, "product_name")
        quantity_text = _extract_labeled_value(text, "quantity")
        quantity = _quantity(quantity_text)
        if not part_no and quantity is None and not product_name:
            continue
        missing = []
        if not part_no:
            missing.append("PN")
        if quantity is None:
            missing.append("数量")
        records.append(
            {
                "order_no": _extract_labeled_value(text, "order_no") or fallback_order_no,
                "part_no": part_no,
                "product_name": product_name,
                "quantity": quantity,
                "unit": _extract_labeled_value(text, "unit"),
                "source": f"正文第{index}段",
                "needs_review": bool(missing),
                "review_reason": f"未识别{'、'.join(missing)}" if missing else "",
            }
        )
    return records


def extract_records(units: list[dict]) -> list[dict]:
    fallback_order_no = _document_value(units, "order_no")
    records: list[dict] = []
    for table_number, unit in enumerate((unit for unit in units if unit.get("type") == "table"), start=1):
        if unit.get("type") == "table":
            records.extend(_records_from_table(unit, fallback_order_no, table_number))
    # 无表格明细时，再尝试“PN: ... 产品名: ... 数量: ...”形式的正文。
    if not any(record.get("part_no") or record.get("quantity") is not None for record in records):
        records.extend(_records_from_paragraphs(units, fallback_order_no))
    return records


def _part_key(value: object) -> str:
    return re.sub(r"\s+", "", _plain(value)).upper()


def _decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _group(records: list[dict]) -> dict[str, dict]:
    grouped: dict[str, dict] = defaultdict(
        lambda: {"part_no": "", "product_names": set(), "quantity": Decimal("0"), "order_nos": set(), "units": set(), "sources": []}
    )
    for record in records:
        key = _part_key(record.get("part_no"))
        if not key:
            continue
        item = grouped[key]
        item["part_no"] = item["part_no"] or _plain(record.get("part_no"))
        item["quantity"] += record.get("quantity") or Decimal("0")
        product_name = _plain(record.get("product_name"))
        if product_name:
            item["product_names"].add(product_name)
        order_no = _plain(record.get("order_no"))
        if order_no:
            item["order_nos"].add(order_no)
        unit = _plain(record.get("unit"))
        if unit:
            item["units"].add(unit)
        source = _plain(record.get("source"))
        if source:
            item["sources"].append(source)
    return dict(grouped)


def compare_documents(order_units: list[dict], delivery_units: list[dict]) -> dict:
    order_records = extract_records(order_units)
    delivery_records = extract_records(delivery_units)
    order_complete = [record for record in order_records if not record.get("needs_review")]
    delivery_complete = [record for record in delivery_records if not record.get("needs_review")]
    order_review = [record for record in order_records if record.get("needs_review")]
    delivery_review = [record for record in delivery_records if record.get("needs_review")]
    order_group = _group(order_complete)
    delivery_group = _group(delivery_complete)

    review_by_key: dict[str, dict[str, list[dict]]] = defaultdict(lambda: {"order": [], "delivery": []})
    unkeyed_reviews: list[tuple[str, dict]] = []
    for role, records in (("order", order_review), ("delivery", delivery_review)):
        for record in records:
            key = _part_key(record.get("part_no"))
            if key:
                review_by_key[key][role].append(record)
            else:
                unkeyed_reviews.append((role, record))

    rows = []
    counts = {"数量一致": 0, "部分交付": 0, "超量送货": 0, "本次未送": 0, "订单外多送": 0, "订单号不一致": 0, "单位不一致": 0, "需要人工复核": 0}
    blocked_keys = set(review_by_key)
    order_has_unkeyed_review = any(not _part_key(record.get("part_no")) for record in order_review)
    delivery_has_unkeyed_review = any(not _part_key(record.get("part_no")) for record in delivery_review)
    for key in sorted((set(order_group) | set(delivery_group)) - blocked_keys):
        left = order_group.get(key)
        right = delivery_group.get(key)
        review_reason = ""
        if left is None:
            if order_has_unkeyed_review:
                issues = ["需要人工复核"]
                review_reason = "订单存在未识别PN的明细，无法确认该项是否属于订单外多送"
            else:
                issues = ["订单外多送"]
            ordered = Decimal("0")
            delivered = right["quantity"]
        elif right is None:
            if delivery_has_unkeyed_review:
                issues = ["需要人工复核"]
                review_reason = "送货单存在未识别PN的明细，无法确认该项是否属于本次未送"
            else:
                issues = ["本次未送"]
            ordered = left["quantity"]
            delivered = Decimal("0")
        else:
            ordered = left["quantity"]
            delivered = right["quantity"]
            issues = []
            left_orders = left["order_nos"]
            right_orders = right["order_nos"]
            if left_orders and right_orders and left_orders.isdisjoint(right_orders):
                issues.append("订单号不一致")
            if left["units"] and right["units"] and left["units"].isdisjoint(right["units"]):
                issues.append("单位不一致")
            if delivered < ordered:
                issues.append("部分交付")
            elif delivered > ordered:
                issues.append("超量送货")
            else:
                issues.append("数量一致")
        for issue in issues:
            counts[issue] += 1
        status = "、".join(issues)
        rows.append(
            {
                "part_no": (left or right)["part_no"],
                "order_product_name": "、".join(sorted((left or {}).get("product_names", set()))),
                "delivery_product_name": "、".join(sorted((right or {}).get("product_names", set()))),
                "order_no": "、".join(sorted((left or {}).get("order_nos", set()))),
                "delivery_order_no": "、".join(sorted((right or {}).get("order_nos", set()))),
                "order_unit": "、".join(sorted((left or {}).get("units", set()))),
                "delivery_unit": "、".join(sorted((right or {}).get("units", set()))),
                "ordered_quantity": _decimal_text(ordered),
                "delivered_quantity": _decimal_text(delivered),
                "difference": _decimal_text(delivered - ordered),
                "remaining": _decimal_text(max(ordered - delivered, Decimal("0"))),
                "status": status,
                "issues": issues,
                "review_reason": review_reason,
            }
        )

    def record_values(records: list[dict], field: str) -> set[str]:
        return {_plain(record.get(field)) for record in records if _plain(record.get(field))}

    def review_quantity(group: dict | None, records: list[dict]) -> str:
        if group is not None:
            return _decimal_text(group["quantity"])
        quantities = [record.get("quantity") for record in records if record.get("quantity") is not None]
        return _decimal_text(sum(quantities, Decimal("0"))) if quantities else ""

    for key in sorted(review_by_key):
        review = review_by_key[key]
        left = order_group.get(key)
        right = delivery_group.get(key)
        left_records = review["order"]
        right_records = review["delivery"]
        reasons = []
        for role_label, records in (("订单", left_records), ("送货单", right_records)):
            for record in records:
                reason = record.get("review_reason") or "字段无法确认"
                source = record.get("source") or ""
                reasons.append(f"{role_label}{reason}{f'（{source}）' if source else ''}")
        counts["需要人工复核"] += 1
        part_no = (left or right or {}).get("part_no") or next(
            (record.get("part_no") for record in left_records + right_records if record.get("part_no")),
            "未识别",
        )
        rows.append({
            "part_no": part_no,
            "order_product_name": "、".join(sorted((left or {}).get("product_names", set()) | record_values(left_records, "product_name"))),
            "delivery_product_name": "、".join(sorted((right or {}).get("product_names", set()) | record_values(right_records, "product_name"))),
            "order_no": "、".join(sorted((left or {}).get("order_nos", set()) | record_values(left_records, "order_no"))),
            "delivery_order_no": "、".join(sorted((right or {}).get("order_nos", set()) | record_values(right_records, "order_no"))),
            "order_unit": "、".join(sorted((left or {}).get("units", set()) | record_values(left_records, "unit"))),
            "delivery_unit": "、".join(sorted((right or {}).get("units", set()) | record_values(right_records, "unit"))),
            "ordered_quantity": review_quantity(left, left_records),
            "delivered_quantity": review_quantity(right, right_records),
            "difference": "",
            "remaining": "",
            "status": "需要人工复核",
            "issues": ["需要人工复核"],
            "review_reason": "；".join(reasons),
        })

    for role, record in unkeyed_reviews:
        counts["需要人工复核"] += 1
        reason = record.get("review_reason") or "字段无法确认"
        source = record.get("source") or ""
        is_order = role == "order"
        rows.append({
            "part_no": "未识别",
            "order_product_name": record.get("product_name", "") if is_order else "",
            "delivery_product_name": record.get("product_name", "") if not is_order else "",
            "order_no": record.get("order_no", "") if is_order else "",
            "delivery_order_no": record.get("order_no", "") if not is_order else "",
            "order_unit": record.get("unit", "") if is_order else "",
            "delivery_unit": record.get("unit", "") if not is_order else "",
            "ordered_quantity": _decimal_text(record["quantity"]) if is_order and record.get("quantity") is not None else "",
            "delivered_quantity": _decimal_text(record["quantity"]) if not is_order and record.get("quantity") is not None else "",
            "difference": "",
            "remaining": "",
            "status": "需要人工复核",
            "issues": ["需要人工复核"],
            "review_reason": f"{'订单' if is_order else '送货单'}{reason}{f'（{source}）' if source else ''}",
        })

    warnings = []
    if not order_complete and not order_review:
        warnings.append("第1列未提取到同时包含零件号和数量的订单明细。")
    if not delivery_complete and not delivery_review:
        warnings.append("第2列未提取到同时包含零件号和数量的送货明细。")
    order_party = _resolve_party(order_units)
    delivery_party = _resolve_party(delivery_units)
    if order_party["supplier"] and delivery_party["supplier"]:
        if _header_key(order_party["supplier"]) != _header_key(delivery_party["supplier"]):
            warnings.append(
                f"供应商不一致：订单为“{order_party['supplier']}”，"
                f"送货单为“{delivery_party['supplier']}”。"
            )
    if order_party["customer"] and delivery_party["customer"]:
        if _header_key(order_party["customer"]) != _header_key(delivery_party["customer"]):
            warnings.append(
                f"客户不一致：订单为“{order_party['customer']}”，"
                f"送货单为“{delivery_party['customer']}”。"
            )
    if order_party["review_required"] or delivery_party["review_required"]:
        unique_candidates = list(
            dict.fromkeys(order_party["candidates"] + delivery_party["candidates"])
        )
        if unique_candidates:
            warnings.append(
                f"公司主体需要人工确认：{'、'.join(unique_candidates[:5])}"
            )
    return {
        "rows": rows,
        "counts": counts,
        "order_record_count": len(order_complete),
        "delivery_record_count": len(delivery_complete),
        "order_review_count": len(order_review),
        "delivery_review_count": len(delivery_review),
        "order_meta": {
            "customer": order_party["customer"],
            "supplier": order_party["supplier"],
            "order_no": _document_value(order_units, "order_no"),
        },
        "delivery_meta": {
            "customer": delivery_party["customer"],
            "supplier": delivery_party["supplier"],
            "order_no": _document_value(delivery_units, "order_no"),
            "delivery_no": _document_value(delivery_units, "delivery_no"),
            "delivery_date": _document_value(delivery_units, "delivery_date"),
        },
        "order_party_candidates": order_party["candidates"],
        "delivery_party_candidates": delivery_party["candidates"],
        "party_review_required": order_party["review_required"]
        or delivery_party["review_required"],
        "warnings": warnings,
    }
