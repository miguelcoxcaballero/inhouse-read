#!/usr/bin/env python3
"""Verify the release APK identity and signing continuity before publication."""

import argparse
import os
import re
import subprocess
from pathlib import Path

PACKAGE = "com.inhousesoftware.read"
VERSION_NAME = "1.1.20"
VERSION_CODE = 33


def certificate(apk, build_tools):
    output = subprocess.check_output(
        [str(build_tools / "apksigner"), "verify", "--verbose", "--print-certs", str(apk)], text=True
    )
    digests = re.findall(r"certificate SHA-256 digest:\s*([a-f0-9]{64})", output, re.I)
    if not digests:
        raise ValueError("APK signing certificate was not reported")
    return sorted(set(digest.lower() for digest in digests))


def identity(apk, build_tools):
    output = subprocess.check_output([str(build_tools / "aapt"), "dump", "badging", str(apk)], text=True)
    match = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", output)
    if not match:
        raise ValueError("APK package identity was not reported")
    return match[1], int(match[2]), match[3]


def verify(apk, previous, build_tools):
    if certificate(apk, build_tools) != certificate(previous, build_tools):
        raise ValueError("APK signing key changed")
    if identity(apk, build_tools) != (PACKAGE, VERSION_CODE, VERSION_NAME):
        raise ValueError("APK package or version does not match the release")
    previous_package, previous_code, _ = identity(previous, build_tools)
    if previous_package != PACKAGE or previous_code >= VERSION_CODE:
        raise ValueError("The previous APK must have the same package and a lower versionCode")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("previous", type=Path)
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
    stable_tools = [path for path in (sdk / "build-tools").iterdir() if re.fullmatch(r"\d+\.\d+\.\d+", path.name)]
    build_tools = sdk / "build-tools" / "36.0.0"
    if not build_tools.is_dir():
        build_tools = max(stable_tools, key=lambda path: tuple(map(int, path.name.split("."))))
    verify(args.apk, args.previous, build_tools)
    print(f"APK verified: {PACKAGE} {VERSION_NAME} / {VERSION_CODE}; signing key unchanged.")


if __name__ == "__main__":
    main()
