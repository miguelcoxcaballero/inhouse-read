#!/usr/bin/env python3
"""Verify that the signed APK actually renders the live app in Android."""

import argparse
import json
import re
import subprocess
import time
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile


SCREENSHOT = Path("android-status-bar.png")
UI_DUMP = Path("android-ui.xml")
OCR_TEXT = Path("android-screen-text.txt")

# Shells with this bridge method draw the WebView behind the status bar and
# let the page keep the bar's strip free; older APKs pad the WebView natively
# on the shelf and remove that padding while reading.
STABLE_INSET_MARKER = b"getSafeTopInset"
LAYOUT = {"contract": "legacy", "webViewBounds": None, "statusBarBottom": 0}
HEADER_CONTROLS = {
    True: re.compile(r"Volver a la estanter.a"),
    False: re.compile(r"Elegir archivo del dispositivo|Abrir desde Google Drive|Conectar cuenta de Google|Cuenta de Google"),
}


def apk_layout_contract(apk):
    with ZipFile(apk) as archive:
        dex = b"".join(archive.read(name) for name in archive.namelist() if name.endswith(".dex"))
    return "stable-inset" if STABLE_INSET_MARKER in dex else "legacy"


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def capture(screenshot=SCREENSHOT, ui_dump=UI_DUMP):
    errors = []
    for attempt in range(4):
        dumped = None
        try:
            run("adb", "shell", "screencap", "-p", "/sdcard/inhouse-read-status-bar.png")
            run("adb", "pull", "/sdcard/inhouse-read-status-bar.png", str(screenshot))
            # uiautomator can exit 0 after an idle timeout without writing XML.
            # Remove both old copies so an earlier successful dump cannot pass.
            ui_dump.unlink(missing_ok=True)
            run("adb", "shell", "rm", "-f", "/sdcard/inhouse-read-ui.xml")
            dumped = run("adb", "shell", "uiautomator", "dump", "--compressed", "/sdcard/inhouse-read-ui.xml")
            run("adb", "pull", "/sdcard/inhouse-read-ui.xml", str(ui_dump))
            return ElementTree.parse(ui_dump).getroot()
        except (subprocess.CalledProcessError, OSError, ElementTree.ParseError) as error:
            detail = {"attempt": attempt + 1, "error": str(error)}
            if isinstance(error, subprocess.CalledProcessError):
                detail.update({"command": error.cmd, "stdout": error.stdout, "stderr": error.stderr})
            if dumped is not None:
                detail["dumpStdout"] = dumped.stdout
                detail["dumpStderr"] = dumped.stderr
            errors.append(detail)
            print("Android UI capture was not ready: " + json.dumps(detail), flush=True)
            if attempt == 3:
                ui_dump.with_suffix(".capture-errors.json").write_text(json.dumps(errors, indent=2), encoding="utf-8")
                try:
                    Path("android-logcat.txt").write_text(run("adb", "logcat", "-d").stdout, encoding="utf-8")
                except subprocess.CalledProcessError as log_error:
                    print(f"Could not capture Android logcat: {log_error}", flush=True)
                raise
            time.sleep(4)


def node_text(root):
    return " ".join(node.attrib.get("text", "") + " " + node.attrib.get("content-desc", "")
                    for node in root.iter("node"))


def interactive_bookshelf_visible(root):
    # These controls and the empty state are created by bookshelf.js, after
    # startup. A static HTML header alone must never pass this check.
    if not re.search(r"\bSin libros\b", node_text(root), re.I):
        return False
    buttons = [node for node in root.iter("node")
               if node.attrib.get("enabled") == "true"
               and node.attrib.get("class") in ("android.widget.Button", "android.widget.ToggleButton")]
    has_import = any(re.fullmatch(r"A.adir libro", node_text(node).strip(), re.I)
                     for node in buttons)
    # The cabinet now exposes native keyboard/swipe navigation instead of view
    # buttons. Require its named, enabled, focusable JS region; a header or the
    # removed buttons must not stand in for an initialized bookshelf.
    has_region = any(node.attrib.get("enabled") == "true"
                     and node.attrib.get("focusable") == "true"
                     and any(label.strip() == "Estantería" for label in
                             (node.attrib.get("text", ""), node.attrib.get("content-desc", "")))
                     for node in root.iter("node"))
    return has_import and has_region


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
    if not re.search(r"Pixel Launcher", node_text(root), re.I):
        return False
    for node in root.iter("node"):
        if node.attrib.get("resource-id") not in ("android:id/aerr_close", "android:id/aerr_wait"):
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if not bounds:
            raise AssertionError("Android ANR dialog has no usable Wait button bounds")
        left, top, right, bottom = map(int, bounds.groups())
        run("adb", "shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        time.sleep(4)
        return True
    return False


def webview_bounds(root):
    for node in root.iter("node"):
        if node.attrib.get("class") != "android.webkit.WebView":
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if not bounds:
            continue
        return tuple(map(int, bounds.groups()))
    raise AssertionError("The signed APK did not display its WebView")


def verify_webview_bounds(root, reading=False):
    bounds = webview_bounds(root)
    top = bounds[1]
    if LAYOUT["contract"] == "stable-inset":
        # Shown or hidden, the status bar is drawn over the page; the page
        # keeps its strip free itself (verify_stable_page_layout).
        assert top == 0, f"The WebView must extend behind the status bar: {bounds}"
    elif reading:
        assert top == 0, f"Reader retained a native top inset: {bounds}"
    else:
        assert top > 0, "The WebView overlaps the Android status bar"
    print(f"Android WebView bounds (reading={reading}): {bounds}")
    return bounds


def header_control_tops(root, reading):
    tops = []
    for node in root.iter("node"):
        labels = (node.attrib.get("text", "").strip(), node.attrib.get("content-desc", "").strip())
        if not any(HEADER_CONTROLS[reading].fullmatch(label) for label in labels):
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if bounds:
            left, top, right, bottom = map(int, bounds.groups())
            if right > left and bottom > top:
                tops.append(top)
    return tops


def verify_stable_page_layout(root, bounds, reading, status_bar_bottom):
    """Hiding the status bar to read must move nothing: the WebView keeps the
    bounds of the first settled state in every foreground state, and the page
    header stays below the bar's strip whether the bar shows (shelf) or not
    (reader, where only the page's own reserved strip keeps it there)."""
    reference = LAYOUT["webViewBounds"]
    if reference is None:
        LAYOUT["webViewBounds"] = reference = bounds
    assert bounds == reference, f"Reading mode changed the WebView bounds: {reference} -> {bounds}"
    LAYOUT["statusBarBottom"] = max(LAYOUT["statusBarBottom"], status_bar_bottom or 0)
    strip = LAYOUT["statusBarBottom"]
    assert strip > 0, "The status bar frame was absent from dumpsys"
    tops = header_control_tops(root, reading)
    assert tops, "No page header control to compare with the status bar strip"
    assert min(tops) >= strip, f"The page header is under the status bar strip: top {min(tops)} < {strip}"
    return {"contract": LAYOUT["contract"], "webViewBounds": list(reference), "statusBarBottom": strip, "headerTop": min(tops)}


def android_window_state(windows, displays):
    """Read the actual app window and display inset source on Android 15.

    WindowState.dump prints the XOR with defaultVisible(), not the requested
    mask itself: statusBars in that line means the normally visible bar was
    requested hidden. Keep both the request and the real source visibility.
    """
    app_windows = []
    for block in re.split(r"(?m)^\s{2}Window #\d+ ", windows)[1:]:
        title = block.splitlines()[0]
        if re.search(r"com\.inhousesoftware\.read/(?:com\.inhousesoftware\.read\.)?\.?MainActivity\}", title):
            app_windows.append(block)
    assert len(app_windows) == 1, f"Expected one native MainActivity window, found {len(app_windows)}"
    app_window = app_windows[0]
    flags = re.search(r"(?m)^\s+fl=([^\r\n]*)", app_window)
    assert flags, "MainActivity window flags were absent from dumpsys"
    changed = re.search(r"Requested non-default-visibility types:\s*([^\r\n]*)", app_window)
    changed_types = changed.group(1).split() if changed else []
    # Restrict visibility to the display controller's raw InsetsState; copies
    # in source providers or unrelated windows must never satisfy this check.
    controllers = re.findall(r"WindowInsetsStateController\s+(.*?)\s+Control map:", displays, re.S)
    assert len(controllers) == 1, f"Expected one emulator display inset controller, found {len(controllers)}"
    sources = re.findall(r"InsetsSource[^\r\n]*\btype=statusBars\b[^\r\n]*\bvisible=(?:true|false)\b[^\r\n]*", controllers[0])
    assert len(sources) == 1, f"Expected one real status bar inset source, found {len(sources)}"
    status = re.search(r"\bvisible=(true|false)\b", sources[0]).group(1)
    # The source keeps the bar's frame while it is hidden.
    frame = re.search(r"\bframe=\[(\d+),(\d+)\]\[(\d+),(\d+)\]", sources[0])
    focus = re.search(r"\bmCurrentFocus=([^\r\n]+)", windows + "\n" + displays)
    assert focus, "Focused Android window was absent from dumpsys"
    return {
        "window": app_window.splitlines()[0],
        "flags": flags.group(1).strip(),
        "keepScreenOn": "KEEP_SCREEN_ON" in flags.group(1).split(),
        "requestedNonDefaultTypes": changed_types,
        "statusBarRequestedVisible": "statusBars" not in changed_types,
        "statusBarVisible": status == "true",
        "statusBarFrame": list(map(int, frame.groups())) if frame else None,
        "appFocused": bool(re.search(r"com\.inhousesoftware\.read/", focus.group(1))),
    }


def assert_reading_window_state(state, reading, foreground=True):
    assert state["appFocused"] == foreground, f"Unexpected focused window: {state}"
    assert state["keepScreenOn"] == reading, f"KEEP_SCREEN_ON was wrong: {state}"
    assert state["statusBarRequestedVisible"] == (not reading), f"Status bar request was wrong: {state}"
    assert state["statusBarVisible"] == (not reading), f"Actual status bar visibility was wrong: {state}"


def dismiss_import_google_login(root):
    # An imported local book can request Drive sign-in asynchronously. Only
    # cancel the actual Chrome account/first-run screen of this accountless
    # fixture; an arbitrary external activity or an app error must still fail.
    if not any(node.attrib.get("package") == "com.android.chrome" for node in root.iter("node")):
        return False
    text = node_text(root)
    first_run = bool(re.search(r"Welcome to Chrome", text)) and any(
        node.attrib.get("text") in ("Use without an account", "No thanks")
        and node.attrib.get("enabled") == "true" for node in root.iter("node"))
    if not first_run and not google_signin_visible(root):
        return False
    run("adb", "shell", "input", "keyevent", "KEYCODE_BACK")
    run("adb", "shell", "am", "start", "-W", "-n", "com.inhousesoftware.read/.MainActivity")
    print("Cancelled the fixture's external Google sign-in and returned to Read", flush=True)
    return True


def wait_for_reading_display(label, reading, foreground=True, timeout=45, initial_import_title=None):
    assert initial_import_title is None or (reading and foreground), "Import login recovery is only valid on initial reader entry"
    started = time.monotonic()
    deadline = started + timeout
    prefix = "android-reading-" + label
    last_error = None
    timeline = []
    while True:
        capture_started = time.time()
        root = capture(Path(prefix + ".png"), Path(prefix + ".xml"))
        captured = time.time()
        windows = run("adb", "shell", "dumpsys", "window", "windows").stdout
        displays = run("adb", "shell", "dumpsys", "window", "displays").stdout
        Path(prefix + "-windows.txt").write_text(windows, encoding="utf-8")
        Path(prefix + "-displays.txt").write_text(displays, encoding="utf-8")
        text = node_text(root)
        entry = {"attempt": len(timeline) + 1, "elapsedSeconds": round(time.monotonic() - started, 3),
                 "captureStartedAt": capture_started, "captureCompletedAt": captured,
                 "readerVisible": bool(re.search(r"Volver a la estanter.a", text)),
                 "bookshelfVisible": bool(re.search(r"\bBiblioteca\b", text))}
        timeline.append(entry)
        try:
            state = android_window_state(windows, displays)
            entry["windowState"] = state
            assert_reading_window_state(state, reading, foreground)
            if foreground:
                state["webViewBounds"] = verify_webview_bounds(root, reading)
                assert entry["readerVisible"] == reading, "The real reader/shelf UI has not settled"
                if initial_import_title is not None:
                    assert re.search(re.escape(initial_import_title), text, re.I), "Initial reader lost the imported document title"
                if LAYOUT["contract"] == "stable-inset":
                    state["stableLayout"] = verify_stable_page_layout(
                        root, state["webViewBounds"], reading, (state["statusBarFrame"] or [0, 0, 0, 0])[3])
            Path(prefix + ".json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
            Path(prefix + "-timeline.json").write_text(json.dumps(timeline, indent=2) + "\n", encoding="utf-8")
            print(f"Android reading display verified ({label}): {json.dumps(state)}", flush=True)
            return root
        except AssertionError as error:
            last_error = error
            entry["error"] = str(error)
            Path(prefix + ".json").write_text(json.dumps({"error": str(error)}, indent=2) + "\n", encoding="utf-8")
            Path(prefix + "-timeline.json").write_text(json.dumps(timeline, indent=2) + "\n", encoding="utf-8")
            # Keep independently sampled frames rather than overwriting all
            # evidence while an imported book prepares its first 3D return.
            for extension in (".png", ".xml"):
                sample = Path(prefix + extension)
                if sample.is_file():
                    Path(prefix + f"-attempt-{entry['attempt']}" + extension).write_bytes(sample.read_bytes())
            if initial_import_title is not None and dismiss_import_google_login(root):
                entry["action"] = "cancelled-import-google-login-and-returned-to-read"
                Path(prefix + "-timeline.json").write_text(json.dumps(timeline, indent=2) + "\n", encoding="utf-8")
        if time.monotonic() >= deadline:
            try:
                Path("android-logcat.txt").write_text(run("adb", "logcat", "-d").stdout, encoding="utf-8")
            except subprocess.CalledProcessError as log_error:
                print(f"Could not capture Android logcat: {log_error}", flush=True)
            raise AssertionError(f"Android reading display did not settle ({label}): {last_error}")
        time.sleep(2)


def return_to_bookshelf(root):
    for node in root.iter("node"):
        if not re.fullmatch(r"Volver a la estanter.a", node_text(node).strip()):
            continue
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if bounds and node.attrib.get("enabled") == "true":
            left, top, right, bottom = map(int, bounds.groups())
            run("adb", "shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
            return
    raise AssertionError("The loaded document had no usable return-to-bookshelf control")


def open_fixture_document(mode):
    run("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read.intentfixture/.MainActivity", "--es", "mode", mode)
    for attempt in range(24):
        time.sleep(3)
        root = capture(Path("android-import-" + mode + ".png"), Path("android-import-" + mode + ".xml"))
        text = node_text(root)
        # Offline fixture has no Google account: dismiss external login and
        # its cancellation notice, while preserving the imported local book.
        if re.search(r"accounts.google.com|Use without an account|No thanks", text):
            run("adb", "shell", "input", "keyevent", "4")
            continue
        if re.search(r"No se pudo conectar|No se pudo sincronizar", text):
            run("adb", "shell", "input", "keyevent", "66")
            continue
        # The document title is assigned only after reader.open renders the
        # real page and the imported record is saved to IndexedDB.
        if re.search(r"Volver a la estanter.a", text) and re.search("Intent " + mode, text, re.I):
            print(f"Actual content URI imported successfully: {mode}")
            return root
    log = run("adb", "logcat", "-d").stdout
    Path("android-logcat.txt").write_text(log, encoding="utf-8")
    print(run("adb", "shell", "dumpsys", "webviewupdate").stdout, flush=True)
    print("\n".join(line for line in log.splitlines() if re.search(r"chromium|Capacitor/Console|BookImport|Uncaught|SyntaxError", line))[-16000:], flush=True)
    raise AssertionError(f"{mode} import failed: {text[:2000]}")


def verify_loaded_reader_display(mode, background=False):
    if mode == "reading":
        # The public-APK scenario imports directly, without the preceding
        # chooser/cold/warm cases. Chrome may take focus just after the first
        # successful import capture. Handle that only during initial entry;
        # Home, resume and exit continue to require the exact native states.
        root = wait_for_reading_display(mode + "-reader", reading=True, initial_import_title="Intent reading")
    else:
        root = wait_for_reading_display(mode + "-reader", reading=True)
    if background:
        # Home exercises Activity.onPause without destroying the document.
        # Returning must reapply the policy to the same open real PDF.
        run("adb", "shell", "input", "keyevent", "KEYCODE_HOME")
        wait_for_reading_display("background", reading=False, foreground=False)
        run("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read/.MainActivity")
        root = wait_for_reading_display("resumed-reader", reading=True)
        assert re.search("Intent " + mode, node_text(root), re.I), "Returning from Home lost the loaded document"
    return_to_bookshelf(root)
    # A newly imported book has no shelf origin: its first return prepares the
    # 3D model before the flight. Android15 SwiftShader reached the home UI but
    # was still closing at 45s. Only this endpoint gets the full return budget;
    # initial reader, Home release and resume retain their original 45s limit.
    wait_for_reading_display(mode + "-shelf-after", reading=False, timeout=120)


def verify_reading_display():
    # The separate sender APK is a CI artifact, never a release asset. This
    # independent scenario can verify the actual downloaded, signed APK.
    assert Path("intent-fixture-debug.apk").is_file(), "Reading display verification needs intent-fixture-debug.apk from the same build run"
    wait_for_reading_display("shelf-before", reading=False)
    run("adb", "install", "-r", "intent-fixture-debug.apk")
    open_fixture_document("reading")
    verify_loaded_reader_display("reading", background=True)


def verify_book_imports():
    # Verify actual resolver registration for every supported extension/MIME.
    from register_book_imports import MIME_TYPES, EXTENSIONS
    for mime in MIME_TYPES:
        for action in ("VIEW", "SEND", "SEND_MULTIPLE"):
            arguments = ["adb", "shell", "cmd", "package", "query-activities", "--brief", "-a",
                         "android.intent.action." + action, "-t", mime]
            if action == "VIEW": arguments.extend(["-d", "content://test.provider/42"])
            resolved = run(*arguments).stdout
            assert "com.inhousesoftware.read/.MainActivity" in resolved, (action, mime, resolved)
    for extension in EXTENSIONS:
        resolved = run("adb", "shell", "cmd", "package", "query-activities", "--brief", "-a",
                       "android.intent.action.VIEW", "-d", "content://test.provider/book." + extension).stdout
        assert "com.inhousesoftware.read/.MainActivity" in resolved, (extension, resolved)
    run("adb", "install", "-r", "intent-fixture-debug.apk")
    run("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read.intentfixture/.MainActivity", "--es", "mode", "chooser")
    time.sleep(3)
    chooser = capture(Path("android-open-with.png"), Path("android-open-with.xml"))
    assert "Inhouse Read" in node_text(chooser), "Read was absent from Android's real Open with chooser"
    run("adb", "shell", "input", "keyevent", "4")
    # Android15's resolver may retain its bottom sheet after Back. Bring the
    # already loaded app forward before asserting its foreground shelf policy.
    run("adb", "shell", "am", "start", "-W", "-n", "com.inhousesoftware.read/.MainActivity")
    wait_for_reading_display("shelf-before", reading=False)
    for mode in ("cold", "warm", "share"):
        if mode == "cold": run("adb", "shell", "am", "force-stop", "com.inhousesoftware.read")
        open_fixture_document(mode)
        verify_loaded_reader_display(mode, background=(mode == "cold"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", help="The signed APK to install and verify")
    scenario = parser.add_mutually_exclusive_group()
    scenario.add_argument("--google-login", action="store_true")
    scenario.add_argument("--book-imports", action="store_true")
    scenario.add_argument("--reading-display", action="store_true")
    args = parser.parse_args()
    LAYOUT["contract"] = apk_layout_contract(args.apk)
    print(f"Android status bar layout contract: {LAYOUT['contract']}", flush=True)
    run("adb", "install", "-r", args.apk)
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
        if re.search(r"Pixel Launcher isn.t responding", ocr, re.I):
            # A system-launcher ANR can disappear between screencap and the
            # accessibility dump. Retry a fresh capture; never exempt Read ANRs.
            dismiss_emulator_launcher_anr(root)
            time.sleep(4)
            continue
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
        if interactive_bookshelf_visible(root):
            print("Published APK loaded the interactive bookshelf")
            if args.google_login:
                verify_google_login(root)
            if args.book_imports:
                verify_book_imports()
            if args.reading_display:
                verify_reading_display()
            return
        time.sleep(5)
    Path("android-logcat.txt").write_text(run("adb", "logcat", "-d").stdout, encoding="utf-8")
    raise AssertionError("Android painted the header but never loaded the interactive bookshelf")


if __name__ == "__main__":
    main()
