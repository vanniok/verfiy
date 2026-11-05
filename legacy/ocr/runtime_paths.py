"""Validate external private resources and keep generated files out of code."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile


PUBLIC_PROJECT = Path(__file__).resolve().parents[2]


def _absolute_setting(name: str) -> Path:
    value = os.environ.get(name, "").strip()
    if not value or not Path(value).is_absolute():
        raise RuntimeError(f"{name} must be configured as an absolute private path.")
    return Path(value).resolve()


def private_root() -> Path:
    root = _absolute_setting("VERIFY_PRIVATE_DIR")
    if root == PUBLIC_PROJECT or root in PUBLIC_PROJECT.parents or PUBLIC_PROJECT in root.parents:
        raise RuntimeError("VERIFY_PRIVATE_DIR must be separate from the public application directory.")
    if not root.is_dir():
        raise RuntimeError("VERIFY_PRIVATE_DIR does not exist or is not a directory.")
    return root


def private_path(value: str | Path, label: str) -> Path:
    """Resolve symlinks before checking a path against the private boundary."""
    path = Path(value)
    if not path.is_absolute():
        raise ValueError(f"{label} must be an absolute path inside VERIFY_PRIVATE_DIR.")
    path = path.resolve()
    if private_root() not in path.parents:
        raise ValueError(f"{label} must remain inside VERIFY_PRIVATE_DIR.")
    return path


def data_directory() -> Path:
    path = private_path(_absolute_setting("VERIFY_DATA_DIR"), "VERIFY_DATA_DIR")
    if not path.is_dir():
        raise RuntimeError("VERIFY_DATA_DIR does not exist or is not a directory.")
    return path


def runtime_directory() -> Path:
    path = private_path(_absolute_setting("VERIFY_RUNTIME_DIR"), "VERIFY_RUNTIME_DIR")
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError("Cannot create VERIFY_RUNTIME_DIR inside the private directory.") from exc
    return path


def _runtime_subdirectory(name: str) -> Path:
    path = private_path(runtime_directory() / name, "Runtime resource")
    path.mkdir(parents=True, exist_ok=True)
    return path


def runtime_temp_dir() -> Path:
    return _runtime_subdirectory("local-temp")


def private_model_directory() -> Path:
    if not os.environ.get("VERIFY_MODEL_DIR", "").strip():
        raise RuntimeError("Local OCR requires VERIFY_MODEL_DIR with all three offline models. No models are downloaded.")
    path = private_path(_absolute_setting("VERIFY_MODEL_DIR"), "VERIFY_MODEL_DIR")
    if not path.is_dir():
        raise RuntimeError("VERIFY_MODEL_DIR does not exist; provide the offline model directory. No models are downloaded.")
    return path


def private_profile_path() -> Path | None:
    if not os.environ.get("VERIFY_PRIVATE_PROFILE", "").strip():
        return None
    path = private_path(_absolute_setting("VERIFY_PRIVATE_PROFILE"), "VERIFY_PRIVATE_PROFILE")
    if not path.is_file() or path.suffix.lower() != ".py":
        raise RuntimeError("VERIFY_PRIVATE_PROFILE must point to an existing private Python rules file.")
    return path


def configure_private_environment() -> None:
    """Set temp/cache/home locations before any optional parser or OCR import."""
    private_root()
    data_directory()
    temporary = runtime_temp_dir()
    home = _runtime_subdirectory("home")
    cache = _runtime_subdirectory("cache")
    locations = {
        "TEMP": temporary, "TMP": temporary, "TMPDIR": temporary,
        "HOME": home, "USERPROFILE": home,
        "APPDATA": home / "AppData" / "Roaming",
        "LOCALAPPDATA": home / "AppData" / "Local",
        "XDG_CACHE_HOME": cache, "XDG_CONFIG_HOME": home / ".config",
        "XDG_DATA_HOME": home / ".local" / "share",
        "PADDLE_HOME": cache / "paddle", "PADDLEOCR_HOME": cache / "paddleocr",
        "PADDLE_PDX_CACHE_HOME": cache / "paddlex", "HF_HOME": cache / "huggingface",
        "HUGGINGFACE_HUB_CACHE": cache / "huggingface" / "hub",
        "TRANSFORMERS_CACHE": cache / "huggingface" / "transformers",
        "TORCH_HOME": cache / "torch", "MPLCONFIGDIR": cache / "matplotlib",
        "NUMBA_CACHE_DIR": cache / "numba",
    }
    for name, location in locations.items():
        os.environ[name] = str(private_path(location, name))
    tempfile.tempdir = str(temporary)
    sys.dont_write_bytecode = True
