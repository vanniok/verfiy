"""Create a Verify source-only ZIP from an explicit release file list."""

from pathlib import Path, PurePosixPath
import os
import stat
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).absolute().parent.parent
MANIFEST = "tools/source-files.txt"
ARCHIVE = "verify-source.zip"


def checked_path(relative_name: str) -> Path:
    """Resolve only listed regular files beneath non-reparse directories."""
    name = PurePosixPath(relative_name)
    if (
        name.is_absolute()
        or name.as_posix() != relative_name
        or not name.parts
        or ".." in name.parts
        or any(character in relative_name for character in '\\:*?"<>|')
        or any(part.endswith((".", " ")) for part in name.parts)
    ):
        raise ValueError(f"Invalid source list entry: {relative_name!r}")

    current = ROOT
    for index, component in enumerate((None, *name.parts)):
        if component is not None:
            current = current / component
        info = current.lstat()
        reparse = getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        if stat.S_ISLNK(info.st_mode) or reparse:
            raise ValueError(f"Source list entry crosses a link or reparse point: {relative_name}")
        expected = stat.S_ISREG if index == len(name.parts) else stat.S_ISDIR
        if not expected(info.st_mode):
            raise ValueError(f"Source list entry is not a regular file under the source root: {relative_name}")
    return current


def package_source() -> tuple[Path, int]:
    output = ROOT / ARCHIVE
    if os.path.lexists(output):
        raise FileExistsError(f"Archive already exists. Move it aside before rebuilding: {output}")

    manifest = checked_path(MANIFEST)
    names = [
        line.strip()
        for line in manifest.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    folded = {name.casefold() for name in names}
    if not names or len(folded) != len(names) or ARCHIVE.casefold() in folded:
        raise ValueError("Source list is empty, has duplicates, or includes the output archive.")
    files = [(name, checked_path(name)) for name in names]

    # The ZIP is complete before it gets its final name. Linking on the same
    # filesystem publishes it atomically and fails if the final name exists.
    with tempfile.NamedTemporaryFile(prefix=".verify-source-", suffix=".tmp", dir=ROOT, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with ZipFile(temporary_path, mode="w", compression=ZIP_DEFLATED, strict_timestamps=False) as archive:
            for name, source in files:
                archive.write(source, arcname=name)
        os.link(temporary_path, output)
    finally:
        temporary_path.unlink()
    return output, len(files)


if __name__ == "__main__":
    if len(sys.argv) != 1:
        sys.exit("Usage: python tools/package-source.py")
    try:
        archive_path, count = package_source()
    except (OSError, ValueError) as error:
        sys.exit(str(error))
    print(f"Created {archive_path.name} with {count} listed files.")
