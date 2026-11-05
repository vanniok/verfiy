"""Generic rules API with an explicitly configured, optional private profile."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
import hashlib
from pathlib import Path
import sys
from types import ModuleType

from runtime_paths import private_profile_path


DEFAULT_RULE_PROFILE_LABEL = "通用文档（不改写识别值）"
RULE_PROFILE_OPTIONS = {
    DEFAULT_RULE_PROFILE_LABEL: ("generic", "generic"),
    "可选私有规则（需配置）": ("auto_parts_export", "warehouse"),
}
GENERIC_PDF_HEADER_KEYWORDS = ("型号", "类别", "名称", "序号", "数量", "价格", "单价", "金额", "日期", "规格")


@dataclass(frozen=True)
class RuleApplication:
    rows: list[list[object]]
    changes: tuple[str, ...] = ()


@lru_cache(maxsize=4)
def _load_profile(path: Path) -> ModuleType:
    name = "_verify_private_rules_" + hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:16]
    module = ModuleType(name)
    module.__file__ = str(path)
    sys.modules[name] = module
    try:
        # Compile directly so loading optional rules never creates a pyc beside them.
        exec(compile(path.read_text(encoding="utf-8-sig"), str(path), "exec"), module.__dict__)
        for function in ("apply_rules_to_blocks", "apply_table_rules", "pdf_header_keywords", "rule_label"):
            if not callable(getattr(module, function, None)):
                raise RuntimeError(f"The private rules file does not define {function}().")
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def _private_profile() -> ModuleType:
    path = private_profile_path()
    if path is None:
        raise RuntimeError(
            "The auto_parts_warehouse profile is unavailable. Configure VERIFY_PRIVATE_PROFILE "
            "with a rules file inside VERIFY_PRIVATE_DIR, or choose the generic profile."
        )
    return _load_profile(path)


def _is_generic(industry: str, department: str) -> bool:
    if (industry, department) == ("generic", "generic"):
        return True
    if (industry, department) != ("auto_parts_export", "warehouse"):
        raise ValueError("Unknown document rule profile.")
    return False


def apply_rules_to_blocks(blocks, industry: str, department: str):
    if _is_generic(industry, department):
        return deepcopy(list(blocks)), ()
    return _private_profile().apply_rules_to_blocks(blocks, industry, department)


def apply_table_rules(rows, industry: str, department: str):
    if _is_generic(industry, department):
        return RuleApplication(deepcopy([list(row) for row in rows]))
    return _private_profile().apply_table_rules(rows, industry, department)


def pdf_header_keywords(industry: str) -> tuple[str, ...]:
    if industry == "generic":
        return GENERIC_PDF_HEADER_KEYWORDS
    if industry != "auto_parts_export":
        raise ValueError("Unknown document rule profile.")
    return _private_profile().pdf_header_keywords(industry)


def rule_label(industry: str, department: str) -> str:
    if _is_generic(industry, department):
        return DEFAULT_RULE_PROFILE_LABEL
    return _private_profile().rule_label(industry, department)


__all__ = ["DEFAULT_RULE_PROFILE_LABEL", "RULE_PROFILE_OPTIONS", "RuleApplication",
           "apply_rules_to_blocks", "apply_table_rules", "pdf_header_keywords", "rule_label"]
