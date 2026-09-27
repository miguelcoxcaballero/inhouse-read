#!/usr/bin/env python3
"""Verify that the signed APK actually renders the live app in Android."""

import re
import subprocess
import sys
import time
from pathlib import Path
from xml.etree import ElementTree


SCREENSHOT = Path("android-status-bar.png")
UI_DUMP = Path("android-ui.xml")
OCR_TEXT = Path("android-screen-text.txt")


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def capture():
    run("adb", "shell", "screencap", "-p", "/sdcard/inhouse-read-status-bar.png")
    run("adb", "pull", "/sdcard/inhouse-read-status-bar.png", str(SCREENSHOT))
    run("adb", "shell", "uiautomator", "dump", "/sdcard/inhouse-read-ui.xml")
    run("adb", "pull", "/sdcard/inhouse-read-ui.xml", str(UI_DUMP))
    return ElementTree.parse(UI_DUMP).getroot()


def dismiss_emulator_launcher_anr(root):
    for node in root.iter("node"):
        if node.attrib.get("resource-id") != "android:id/aerr_wait":
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if not bounds:
            raise AssertionError("Android ANR dialog has no usable Wait button bounds")
        left, top, right, bottom = map(int, bounds.groups())
        run("adb", "shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        time.sleep(4)
        return True
    return False


def verify_webview_bounds(root):
    for node in root.iter("node"):
        if node.attrib.get("class") != "android.webkit.WebView":
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if not bounds:
            continue
        top = int(bounds.group(2))
        if top <= 0:
            raise AssertionError("The WebView overlaps the Android status bar")
        print(f"Android status bar reserved above WebView: {top} pixels")
        return
    raise AssertionError("The signed APK did not display its WebView")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: verify_android_app.py <signed-apk>")
    run("adb", "install", "-r", sys.argv[1])
    run("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read/.MainActivity")
    time.sleep(18)
    root = capture()
    for _ in range(3):
        if not dismiss_emulator_launcher_anr(root):
            break
        root = capture()
    verify_webview_bounds(root)

    ocr = run("tesseract", str(SCREENSHOT), "stdout").stdout
    OCR_TEXT.write_text(ocr, encoding="utf-8")
    print("Android screen OCR:", ocr.strip())
    if re.search(r"Webpage not available|ERR_[A-Z_]+|isn't responding", ocr, re.IGNORECASE):
        raise AssertionError("Android displayed an error instead of the app")
    if not re.search(r"inhouse\s+read", ocr, re.IGNORECASE):
        raise AssertionError("Android did not render the Inhouse Read header")


if __name__ == "__main__":
    main()
