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


def capture(screenshot=SCREENSHOT, ui_dump=UI_DUMP):
    run("adb", "shell", "screencap", "-p", "/sdcard/inhouse-read-status-bar.png")
    run("adb", "pull", "/sdcard/inhouse-read-status-bar.png", str(screenshot))
    for attempt in range(4):
        try:
            run("adb", "shell", "uiautomator", "dump", "--compressed", "/sdcard/inhouse-read-ui.xml")
            break
        except subprocess.CalledProcessError as error:
            if attempt == 3:
                raise
            print(f"Android UI service not ready ({error.returncode}); retrying capture", flush=True)
            time.sleep(4)
    run("adb", "pull", "/sdcard/inhouse-read-ui.xml", str(ui_dump))
    return ElementTree.parse(ui_dump).getroot()


def node_text(root):
    return " ".join(node.attrib.get("text", "") + " " + node.attrib.get("content-desc", "")
                    for node in root.iter("node"))


def google_signin_visible(root):
    text = node_text(root)
    if "accounts.google.com" not in text:
        return False
    if re.search(r"invalid_request|redirect_uri_mismatch|Access blocked|Acceso bloqueado", text, re.I):
        return False
    if re.search(r"Email or phone|Correo electr.nico|Choose an account|Elige una cuenta", text, re.I):
        return True
    # Chrome sometimes omits the floating Email/phone label from Android's
    # accessibility tree. The real account page still exposes the input,
    # Google heading and Forgot email link (confirmed against the release APK).
    has_input = any(node.attrib.get("class") == "android.widget.EditText"
                    and node.attrib.get("enabled") == "true" for node in root.iter("node"))
    return has_input and bool(re.search(r"Forgot email|Has olvidado.*correo", text, re.I))


def verify_google_login(root):
    for node in root.iter("node"):
        label = node.attrib.get("content-desc", "") + " " + node.attrib.get("text", "")
        if not re.search(r"Conectar cuenta de Google|Iniciar sesi.n", label):
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if not bounds:
            continue
        left, top, right, bottom = map(int, bounds.groups())
        run("adb", "shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        break
    else:
        raise AssertionError("No Google sign-in button in the installed app")

    for attempt in range(12):
        time.sleep(5)
        auth_root = capture(Path("android-google-login.png"), Path("android-google-login.xml"))
        text = node_text(auth_root)
        Path("android-google-login.txt").write_text(text, encoding="utf-8")
        if re.search(r"invalid_request|redirect_uri_mismatch|Access blocked|Acceso bloqueado", text, re.I):
            raise AssertionError("Google rejected the published APK's OAuth request: " + text[:2000])
        if google_signin_visible(auth_root):
            print("Published APK opened the real Google account sign-in page successfully")
            return
        # Chrome's first launch may require choosing whether to sign into the
        # browser itself. This is unrelated to the app's Google consent.
        for node in auth_root.iter("node"):
            if node.attrib.get("text", "") not in ("Use without an account", "No thanks", "Got it"):
                continue
            bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
            if bounds:
                left, top, right, bottom = map(int, bounds.groups())
                run("adb", "shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
                break
    raise AssertionError("Google account chooser did not appear: " + text[:2000])


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
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: verify_android_app.py <signed-apk> [--google-login]")
    run("adb", "install", "-r", sys.argv[1])
    run("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read/.MainActivity")
    time.sleep(25)
    for attempt in range(15):
        root = capture()
        for _ in range(3):
            if not dismiss_emulator_launcher_anr(root):
                break
            root = capture()
        verify_webview_bounds(root)

        ocr = run("tesseract", str(SCREENSHOT), "stdout").stdout
        OCR_TEXT.write_text(ocr, encoding="utf-8")
        print(f"Android screen OCR (attempt {attempt + 1}):", ocr.strip())
        network_error = re.search(r"Webpage not available|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED", ocr, re.IGNORECASE)
        if network_error and attempt < 2:
            print("Android network was not ready; retrying the production URL")
            time.sleep(15)
            run("adb", "shell", "am", "force-stop", "com.inhousesoftware.read")
            run("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read/.MainActivity")
            time.sleep(8)
            continue
        if re.search(r"Webpage not available|ERR_[A-Z_]+|isn't responding", ocr, re.IGNORECASE):
            raise AssertionError("Android displayed an error instead of the app")
        # HTML/CSS can paint a header before the JS bundle has executed. The
        # empty shelf is created by JS and proves the app is actually ready.
        if re.search(r"Tu estanter.a|A.ade tu primer libro|A.adir tu primer libro", node_text(root), re.I):
            print("Published APK loaded the interactive bookshelf")
            if "--google-login" in sys.argv:
                verify_google_login(root)
            return
        time.sleep(5)
    Path("android-logcat.txt").write_text(run("adb", "logcat", "-d").stdout, encoding="utf-8")
    raise AssertionError("Android painted the header but never loaded the interactive bookshelf")


if __name__ == "__main__":
    main()
