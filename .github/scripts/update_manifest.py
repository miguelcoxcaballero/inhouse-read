#!/usr/bin/env python3
"""Actualiza public/android-update.json con los datos REALES del APK que se
acaba de compilar y firmar (tamano y sha256 calculados sobre el archivo de
verdad, no copiados a mano) — para que el checker de actualizaciones in-app
(src/js/android-update.js) siempre compare contra lo que de verdad esta
publicado en el Release. Se ejecuta como ultimo paso de
.github/workflows/build-android.yml.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "public" / "android-update.json"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if len(sys.argv) != 6:
        print(
            "Uso: update_manifest.py <apk_path> <version> <version_code> <tag> <release_notes>",
            file=sys.stderr,
        )
        sys.exit(1)

    apk_path = Path(sys.argv[1]).resolve()
    version, version_code, tag, release_notes = sys.argv[2:6]

    manifest = {
        "version": version,
        "versionCode": int(version_code),
        "required": True,
        "apkSizeBytes": apk_path.stat().st_size,
        "apkSha256": sha256_of(apk_path),
        "apkUrl": (
            f"https://github.com/miguelcoxcaballero/inhouse-read/releases/download/"
            f"{tag}/{apk_path.name}"
        ),
        "releaseNotes": release_notes,
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"android-update.json actualizado: {manifest['version']} ({manifest['apkSizeBytes']} bytes)")


if __name__ == "__main__":
    main()
