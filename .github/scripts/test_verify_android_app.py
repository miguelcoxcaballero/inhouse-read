#!/usr/bin/env python3
"""Parser and lifecycle contracts for the real Android window verifier."""

import unittest
import subprocess
import tempfile
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from xml.etree import ElementTree

import verify_android_app as verifier


def windows(reading=False, foreground=True):
    changed = "    Requested non-default-visibility types: statusBars\n" if reading else ""
    flag = " KEEP_SCREEN_ON" if reading else ""
    focus = "com.inhousesoftware.read/com.inhousesoftware.read.MainActivity" if foreground else "com.google.android.apps.nexuslauncher/.NexusLauncherActivity"
    return ("WINDOW MANAGER WINDOWS (dumpsys window windows)\n"
            "  Window #0 Window{abc u0 com.inhousesoftware.read/com.inhousesoftware.read.MainActivity}:\n"
            "    mAttrs={(0,0)(fillxfill) ty=BASE_APPLICATION\n"
            f"      fl=LAYOUT_IN_SCREEN LAYOUT_INSET_DECOR{flag}\n"
            "    }\n" + changed + f"  mCurrentFocus=Window{{abc u0 {focus}}}\n")


def displays(visible=True):
    return ("Display: mDisplayId=0\n"
            "  WindowInsetsStateController\n"
            "    InsetsState\n"
            f"      InsetsSource id=7c0a0000 type=statusBars frame=[0,0][1080,24] visible={str(visible).lower()} flags=\n"
            "      InsetsSource id=7c0a0001 type=navigationBars frame=[0,2300][1080,2340] visible=true flags=\n"
            "    Control map:\n"
            "      Window{abc u0 com.inhousesoftware.read/com.inhousesoftware.read.MainActivity}:\n")


def ui(top=0, reading=True):
    reader = '<node text="Volver a la estantería" enabled="true" bounds="[10,10][60,60]"/>' if reading else ''
    return ElementTree.fromstring(f'<hierarchy><node class="android.webkit.WebView" bounds="[0,{top}][1080,2300]">{reader}<node text="Intent reading"/></node></hierarchy>')


def shelf_ui(*, imported=True, import_enabled=True, region=True, region_enabled=True,
             focusable=True, empty=True, legacy_view=False):
    # Expected native projection of the JS role=region/tabindex=0 cabinet:
    # named/focusable view attributes, not DOM classes or literal ARIA roles.
    add = ('<node class="android.widget.Button" content-desc="Añadir libro" '
           f'enabled="{str(import_enabled).lower()}" clickable="true"/>') if imported else ''
    cabinet = ('<node class="android.view.View" content-desc="Estantería" '
               f'enabled="{str(region_enabled).lower()}" focusable="{str(focusable).lower()}"/>') if region else ''
    state = '<node class="android.view.View" text="Sin libros"/>' if empty else ''
    old = '<node class="android.widget.Button" text="Vista de canto" enabled="true"/>' if legacy_view else ''
    return ElementTree.fromstring(f'<hierarchy><node class="android.webkit.WebView">'
                                 f'<node text="Inhouse Read"/>{add}{cabinet}{state}{old}</node></hierarchy>')


class AndroidInteractiveShelfTests(unittest.TestCase):
    def test_current_keyboard_and_swipe_region_with_import_and_empty_state_is_ready(self):
        self.assertTrue(verifier.interactive_bookshelf_visible(shelf_ui()))

    def test_static_header_alone_is_not_an_interactive_shelf(self):
        root = ElementTree.fromstring('<hierarchy><node text="Inhouse Read"/></hierarchy>')
        self.assertFalse(verifier.interactive_bookshelf_visible(root))

    def test_named_focusable_region_requires_the_import_button(self):
        self.assertFalse(verifier.interactive_bookshelf_visible(shelf_ui(imported=False)))

    def test_disabled_import_button_is_not_ready(self):
        self.assertFalse(verifier.interactive_bookshelf_visible(shelf_ui(import_enabled=False)))

    def test_old_view_buttons_do_not_replace_the_current_runtime_region(self):
        self.assertFalse(verifier.interactive_bookshelf_visible(shelf_ui(region=False, legacy_view=True)))

    def test_region_must_be_enabled_and_focusable(self):
        for options in ({'focusable':False}, {'region_enabled':False}):
            with self.subTest(options=options):
                self.assertFalse(verifier.interactive_bookshelf_visible(shelf_ui(**options)))

    def test_region_name_is_exact_and_not_a_header_or_description_text_fallback(self):
        for label in ('Estantería de Inhouse Read', 'Vista isométrica', 'Biblioteca'):
            root = shelf_ui()
            next(node for node in root.iter('node') if node.get('focusable') == 'true').set('content-desc', label)
            with self.subTest(label=label):
                self.assertFalse(verifier.interactive_bookshelf_visible(root))

    def test_region_does_not_exempt_the_missing_js_empty_state(self):
        self.assertFalse(verifier.interactive_bookshelf_visible(shelf_ui(empty=False)))

    def test_text_named_import_is_not_a_native_button(self):
        root = shelf_ui()
        next(node for node in root.iter('node') if node.get('content-desc') == 'Añadir libro').set('class', 'android.view.View')
        self.assertFalse(verifier.interactive_bookshelf_visible(root))


class AndroidCaptureTests(unittest.TestCase):
    def capture_with_failures(self, failures):
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / "android-ui.xml"
            # A previous successful tree must never survive a failed capture.
            dump.write_text('<hierarchy><node text="stale"/></hierarchy>', encoding="utf-8")
            pulls = []

            def run(*args):
                if args[:3] == ("adb", "shell", "rm"):
                    self.assertFalse(dump.exists())
                if args[:3] == ("adb", "pull", "/sdcard/inhouse-read-ui.xml"):
                    pulls.append(args)
                    failure = failures[len(pulls) - 1] if len(pulls) <= len(failures) else None
                    if failure == "missing":
                        raise subprocess.CalledProcessError(1, args, output="", stderr="remote object does not exist")
                    if failure == "malformed":
                        dump.write_text('<hierarchy>', encoding="utf-8")
                    elif failure != "empty":
                        dump.write_text('<hierarchy><node text="fresh"/></hierarchy>', encoding="utf-8")
                return SimpleNamespace(stdout="ERROR: could not get idle state" if len(pulls) == 0 else "dump complete", stderr="")

            with patch.object(verifier, "run", side_effect=run) as command, patch.object(verifier.time, "sleep") as sleep:
                root = verifier.capture(Path(directory) / "screen.png", dump)
            self.assertEqual(verifier.node_text(root).strip(), "fresh")
            self.assertEqual(len(pulls), len(failures) + 1)
            self.assertEqual(sleep.call_count, len(failures))
            self.assertEqual(sum(call.args[:3] == ("adb", "shell", "rm") for call in command.call_args_list), len(pulls))

    def test_exit_zero_without_remote_xml_retries_dump_and_pull(self):
        self.capture_with_failures(["missing"])

    def test_missing_local_xml_does_not_use_previous_dump(self):
        self.capture_with_failures(["empty"])

    def test_malformed_xml_retries_with_a_fresh_dump(self):
        self.capture_with_failures(["malformed"])

    def test_repeated_ui_failure_remains_a_failure_with_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / "android-ui.xml"
            failure = subprocess.CalledProcessError(1, ("adb", "pull"), output="", stderr="remote object does not exist")

            def run(*args):
                if args[:3] == ("adb", "pull", "/sdcard/inhouse-read-ui.xml"):
                    raise failure
                return SimpleNamespace(stdout="captured diagnostics", stderr="")

            with patch.object(verifier, "run", side_effect=run) as command, patch.object(verifier.time, "sleep") as sleep, patch.object(verifier.Path, "write_text") as write:
                with self.assertRaises(subprocess.CalledProcessError):
                    verifier.capture(Path(directory) / "screen.png", dump)
            self.assertEqual(sleep.call_count, 3)
            self.assertEqual(sum(call.args[:3] == ("adb", "shell", "rm") for call in command.call_args_list), 4)
            self.assertEqual(write.call_count, 2)
            self.assertIn('"attempt": 4', write.call_args_list[0].args[0])
            self.assertIn(unittest.mock.call("adb", "logcat", "-d"), command.call_args_list)


class AndroidReadingDisplayVerifierTests(unittest.TestCase):
    def chrome_first_run(self, package="com.android.chrome"):
        return ElementTree.fromstring(f'<hierarchy><node package="{package}" text="Welcome to Chrome"><node text="Use without an account" enabled="true"/></node></hierarchy>')

    def test_initial_import_cancels_only_actual_chrome_first_run(self):
        with patch.object(verifier, "run") as run:
            self.assertTrue(verifier.dismiss_import_google_login(self.chrome_first_run()))
        self.assertEqual(run.call_args_list, [
            unittest.mock.call("adb", "shell", "input", "keyevent", "KEYCODE_BACK"),
            unittest.mock.call("adb", "shell", "am", "start", "-W", "-n", "com.inhousesoftware.read/.MainActivity"),
        ])

    def test_initial_import_cancels_actual_chrome_google_account_form(self):
        root = ElementTree.fromstring('<hierarchy><node package="com.android.chrome" text="accounts.google.com Forgot email?"><node class="android.widget.EditText" enabled="true"/></node></hierarchy>')
        with patch.object(verifier, "run") as run:
            self.assertTrue(verifier.dismiss_import_google_login(root))
        self.assertEqual(run.call_count, 2)

    def test_initial_import_does_not_cancel_unrelated_or_rejected_screens(self):
        roots = [
            self.chrome_first_run("com.inhousesoftware.read"),
            ElementTree.fromstring('<hierarchy><node package="com.android.chrome" text="An unrelated page"/></hierarchy>'),
            ElementTree.fromstring('<hierarchy><node package="com.android.chrome" text="accounts.google.com invalid_request Email or phone"/></hierarchy>'),
            ElementTree.fromstring('<hierarchy><node package="com.android.chrome" text="Welcome to Chrome"><node text="Use without an account" enabled="false"/></node></hierarchy>'),
        ]
        with patch.object(verifier, "run") as run:
            for root in roots:
                with self.subTest(text=verifier.node_text(root)):
                    self.assertFalse(verifier.dismiss_import_google_login(root))
        run.assert_not_called()

    def test_async_import_login_recovers_before_strict_native_reader_checks(self):
        samples = iter([self.chrome_first_run(), ui()])
        window_samples = iter([windows(foreground=False), windows(True)])
        display_samples = iter([displays(), displays(False)])
        def run(*args):
            output = next(window_samples) if args[-1] == "windows" else next(display_samples) if args[-1] == "displays" else "returned to Read"
            return SimpleNamespace(stdout=output, stderr="")
        with patch.object(verifier, "capture", side_effect=lambda *_: next(samples)), patch.object(verifier, "run", side_effect=run) as command, patch.object(verifier.time, "monotonic", side_effect=[0, 1, 2, 4]), patch.object(verifier.time, "sleep"), patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier.Path, "write_text") as write:
            result = verifier.wait_for_reading_display("reading-reader", reading=True, initial_import_title="Intent reading")
        self.assertEqual(verifier.verify_webview_bounds(result, reading=True)[1], 0)
        self.assertIn(unittest.mock.call("adb", "shell", "am", "start", "-W", "-n", "com.inhousesoftware.read/.MainActivity"), command.call_args_list)
        timeline = json.loads(next(call.args[0] for call in reversed(write.call_args_list) if call.args[0].startswith("[")))
        self.assertIn("error", timeline[0])
        self.assertEqual(timeline[0]["action"], "cancelled-import-google-login-and-returned-to-read")
        self.assertTrue(timeline[1]["windowState"]["keepScreenOn"])
        self.assertFalse(timeline[1]["windowState"]["statusBarVisible"])
        self.assertNotIn("error", timeline[1])

    def test_login_recovery_never_exempts_missing_native_keep_flag(self):
        samples = iter([self.chrome_first_run(), ui()])
        window_samples = iter([windows(foreground=False), windows()])
        def run(*args):
            return SimpleNamespace(stdout=next(window_samples) if args[-1] == "windows" else displays() if args[-1] == "displays" else "diagnostic log", stderr="")
        with patch.object(verifier, "capture", side_effect=lambda *_: next(samples)), patch.object(verifier, "run", side_effect=run), patch.object(verifier.time, "monotonic", side_effect=[0, 1, 2, 45, 45]), patch.object(verifier.time, "sleep"), patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier.Path, "write_text"):
            with self.assertRaisesRegex(AssertionError, "did not settle.*KEEP_SCREEN_ON"):
                verifier.wait_for_reading_display("reading-reader", reading=True, initial_import_title="Intent reading")

    def test_other_native_stages_never_cancel_external_login(self):
        def run(*args):
            return SimpleNamespace(stdout=windows(foreground=False) if args[-1] == "windows" else displays() if args[-1] == "displays" else "diagnostic log", stderr="")
        with patch.object(verifier, "capture", return_value=self.chrome_first_run()), patch.object(verifier, "run", side_effect=run), patch.object(verifier, "dismiss_import_google_login") as dismiss, patch.object(verifier.time, "monotonic", side_effect=[0, 45, 45]), patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier.Path, "write_text"):
            with self.assertRaisesRegex(AssertionError, "did not settle.*focused"):
                verifier.wait_for_reading_display("resumed-reader", reading=True)
        dismiss.assert_not_called()

    def test_initial_reader_must_preserve_the_real_pdf_title(self):
        def run(*args):
            return SimpleNamespace(stdout=windows(True) if args[-1] == "windows" else displays(False) if args[-1] == "displays" else "diagnostic log", stderr="")
        with patch.object(verifier, "capture", return_value=ui()), patch.object(verifier, "run", side_effect=run), patch.object(verifier.time, "monotonic", side_effect=[0, 45, 45]), patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier.Path, "write_text"):
            with self.assertRaisesRegex(AssertionError, "did not settle.*document title"):
                verifier.wait_for_reading_display("reading-reader", reading=True, initial_import_title="Intent another-document")

    def test_import_login_recovery_rejects_background_and_shelf_stages(self):
        with patch.object(verifier, "run") as run, patch.object(verifier, "capture") as capture:
            for options in ({"reading": False}, {"reading": True, "foreground": False}):
                with self.subTest(options=options), self.assertRaisesRegex(AssertionError, "only valid on initial reader entry"):
                    verifier.wait_for_reading_display("invalid-stage", initial_import_title="Intent reading", **options)
        run.assert_not_called()
        capture.assert_not_called()

    def test_chooser_returns_to_actual_app_before_foreground_shelf_checks(self):
        chooser = ElementTree.fromstring('<hierarchy><node text="Inhouse Read"/></hierarchy>')
        with patch.object(verifier, "run", return_value=SimpleNamespace(stdout="com.inhousesoftware.read/.MainActivity", stderr="")) as run, patch.object(verifier, "capture", return_value=chooser), patch.object(verifier.time, "sleep"), patch.object(verifier, "wait_for_reading_display") as wait, patch.object(verifier, "open_fixture_document") as opened, patch.object(verifier, "verify_loaded_reader_display") as verified:
            verifier.verify_book_imports()
        self.assertEqual(run.call_args_list[-5:-1], [
            unittest.mock.call("adb", "install", "-r", "intent-fixture-debug.apk"),
            unittest.mock.call("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read.intentfixture/.MainActivity", "--es", "mode", "chooser"),
            unittest.mock.call("adb", "shell", "input", "keyevent", "4"),
            unittest.mock.call("adb", "shell", "am", "start", "-W", "-n", "com.inhousesoftware.read/.MainActivity"),
        ])
        self.assertEqual(run.call_args_list[-1], unittest.mock.call("adb", "shell", "am", "force-stop", "com.inhousesoftware.read"))
        wait.assert_called_once_with("shelf-before", reading=False)
        self.assertEqual(opened.call_args_list, [unittest.mock.call(mode) for mode in ("cold", "warm", "share")])
        self.assertEqual(verified.call_args_list, [unittest.mock.call(mode, background=mode == "cold") for mode in ("cold", "warm", "share")])

    def test_missing_read_in_the_real_chooser_still_fails_before_app_return(self):
        chooser = ElementTree.fromstring('<hierarchy><node text="Drive PDF Viewer"/></hierarchy>')
        with patch.object(verifier, "run", return_value=SimpleNamespace(stdout="com.inhousesoftware.read/.MainActivity", stderr="")), patch.object(verifier, "capture", return_value=chooser), patch.object(verifier.time, "sleep"), patch.object(verifier, "wait_for_reading_display") as wait, patch.object(verifier, "open_fixture_document") as opened:
            with self.assertRaisesRegex(AssertionError, "absent from Android's real Open with chooser"):
                verifier.verify_book_imports()
        wait.assert_not_called()
        opened.assert_not_called()

    def test_closing_samples_until_native_policy_and_shelf_both_restore(self):
        samples = iter([ui(), ui(24, False)])
        window_samples = iter([windows(True), windows()])
        display_samples = iter([displays(False), displays()])
        def run(*args):
            return SimpleNamespace(stdout=next(window_samples) if args[-1] == "windows" else next(display_samples), stderr="")
        with patch.object(verifier, "capture", side_effect=lambda *_: next(samples)), patch.object(verifier, "run", side_effect=run), patch.object(verifier.time, "monotonic", side_effect=[0, 1, 2, 4]), patch.object(verifier.time, "sleep") as sleep, patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier.Path, "write_text") as write:
            result = verifier.wait_for_reading_display("closing", reading=False, timeout=120)
        self.assertEqual(verifier.verify_webview_bounds(result, reading=False)[1], 24)
        sleep.assert_called_once_with(2)
        timeline = json.loads(next(call.args[0] for call in reversed(write.call_args_list) if call.args[0].startswith("[")))
        self.assertEqual([entry["readerVisible"] for entry in timeline], [True, False])
        self.assertEqual([entry["windowState"]["keepScreenOn"] for entry in timeline], [True, False])
        self.assertIn("error", timeline[0])
        self.assertNotIn("error", timeline[1])

    def test_reader_gone_does_not_exempt_a_native_flag_remaining_enabled(self):
        def run(*args):
            return SimpleNamespace(stdout=windows(True) if args[-1] == "windows" else displays(False) if args[-1] == "displays" else "diagnostic log", stderr="")
        with patch.object(verifier, "capture", return_value=ui(24, False)), patch.object(verifier, "run", side_effect=run) as command, patch.object(verifier.time, "monotonic", side_effect=[0, 120, 120]), patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier.Path, "write_text"):
            with self.assertRaisesRegex(AssertionError, "did not settle.*KEEP_SCREEN_ON"):
                verifier.wait_for_reading_display("closing", reading=False, timeout=120)
        self.assertIn(unittest.mock.call("adb", "logcat", "-d"), command.call_args_list)

    def test_native_restore_does_not_exempt_a_reader_still_visible(self):
        def run(*args):
            return SimpleNamespace(stdout=windows() if args[-1] == "windows" else displays() if args[-1] == "displays" else "diagnostic log", stderr="")
        with patch.object(verifier, "capture", return_value=ui(24)), patch.object(verifier, "run", side_effect=run), patch.object(verifier.time, "monotonic", side_effect=[0, 120, 120]), patch.object(verifier.Path, "write_text"), patch.object(verifier.Path, "is_file", return_value=False):
            with self.assertRaisesRegex(AssertionError, "real reader/shelf UI has not settled"):
                verifier.wait_for_reading_display("closing", reading=False, timeout=120)

    def test_return_without_home_extends_only_the_final_endpoint(self):
        with patch.object(verifier, "wait_for_reading_display", return_value=ui()) as wait, patch.object(verifier, "return_to_bookshelf"), patch.object(verifier, "run") as run:
            verifier.verify_loaded_reader_display("warm", background=False)
        self.assertEqual(wait.call_args_list, [unittest.mock.call("warm-reader", reading=True), unittest.mock.call("warm-shelf-after", reading=False, timeout=120)])
        run.assert_not_called()

    def test_reader_requires_flag_request_and_real_hidden_bar(self):
        state = verifier.android_window_state(windows(True), displays(False))
        self.assertTrue(state["keepScreenOn"])
        self.assertFalse(state["statusBarRequestedVisible"])
        self.assertFalse(state["statusBarVisible"])
        verifier.assert_reading_window_state(state, reading=True)

    def test_shelf_uses_default_visible_request_and_no_keep_flag(self):
        state = verifier.android_window_state(windows(), displays())
        verifier.assert_reading_window_state(state, reading=False)

    def test_pause_releases_flag_and_restores_bar_without_app_focus(self):
        state = verifier.android_window_state(windows(foreground=False), displays())
        verifier.assert_reading_window_state(state, reading=False, foreground=False)

    def test_hidden_request_does_not_pass_if_actual_bar_is_visible(self):
        state = verifier.android_window_state(windows(True), displays(True))
        with self.assertRaisesRegex(AssertionError, "Actual status bar"):
            verifier.assert_reading_window_state(state, reading=True)

    def test_visible_request_does_not_pass_even_if_bar_is_hidden(self):
        state = verifier.android_window_state(windows().replace("LAYOUT_INSET_DECOR", "LAYOUT_INSET_DECOR KEEP_SCREEN_ON"), displays(False))
        with self.assertRaisesRegex(AssertionError, "Status bar request"):
            verifier.assert_reading_window_state(state, reading=True)

    def test_flag_must_be_removed_after_exit(self):
        state = verifier.android_window_state(windows().replace("LAYOUT_INSET_DECOR", "LAYOUT_INSET_DECOR KEEP_SCREEN_ON"), displays())
        with self.assertRaisesRegex(AssertionError, "KEEP_SCREEN_ON"):
            verifier.assert_reading_window_state(state, reading=False)

    def test_foreground_must_really_return_to_app(self):
        state = verifier.android_window_state(windows(True, foreground=False), displays(False))
        with self.assertRaisesRegex(AssertionError, "focused"):
            verifier.assert_reading_window_state(state, reading=True)

    def test_rejects_missing_window(self):
        with self.assertRaisesRegex(AssertionError, "one native MainActivity"):
            verifier.android_window_state(windows().replace("MainActivity", "OtherActivity"), displays())

    def test_rejects_duplicate_window(self):
        with self.assertRaisesRegex(AssertionError, "found 2"):
            verifier.android_window_state(windows() + windows(), displays())

    def test_rejects_missing_flags(self):
        with self.assertRaisesRegex(AssertionError, "flags were absent"):
            verifier.android_window_state(windows().replace("fl=", "unknown="), displays())

    def test_rejects_missing_focus(self):
        with self.assertRaisesRegex(AssertionError, "Focused Android window"):
            verifier.android_window_state(windows().replace("mCurrentFocus=", "unknown="), displays())

    def test_rejects_missing_display_controller(self):
        with self.assertRaisesRegex(AssertionError, "inset controller"):
            verifier.android_window_state(windows(), "")

    def test_rejects_ambiguous_display_controllers(self):
        with self.assertRaisesRegex(AssertionError, "found 2"):
            verifier.android_window_state(windows(), displays() + displays())

    def test_ignores_copied_source_outside_controller(self):
        state = verifier.android_window_state(windows(True), displays(False) + "InsetsSource type=statusBars visible=true\n")
        verifier.assert_reading_window_state(state, reading=True)

    def test_rejects_missing_real_status_source(self):
        with self.assertRaisesRegex(AssertionError, "status bar inset source"):
            verifier.android_window_state(windows(), displays().replace("type=statusBars", "type=captionBar"))

    def test_accepts_crlf_and_short_component_name(self):
        state = verifier.android_window_state(windows(True).replace("/com.inhousesoftware.read.MainActivity", "/.MainActivity").replace("\n", "\r\n"), displays(False).replace("\n", "\r\n"))
        verifier.assert_reading_window_state(state, reading=True)

    def test_reader_has_no_native_top_padding(self):
        self.assertEqual(verifier.verify_webview_bounds(ui(), reading=True)[1], 0)
        with self.assertRaisesRegex(AssertionError, "top inset"):
            verifier.verify_webview_bounds(ui(24), reading=True)

    def test_shelf_reserves_status_bar_top_padding(self):
        self.assertEqual(verifier.verify_webview_bounds(ui(24, False))[1], 24)
        with self.assertRaisesRegex(AssertionError, "overlaps"):
            verifier.verify_webview_bounds(ui(0, False))

    def test_missing_webview_fails(self):
        with self.assertRaisesRegex(AssertionError, "WebView"):
            verifier.verify_webview_bounds(ElementTree.fromstring('<hierarchy/>'), reading=True)

    def test_return_taps_actual_back_control(self):
        with patch.object(verifier, "run") as run:
            verifier.return_to_bookshelf(ui())
        run.assert_called_once_with("adb", "shell", "input", "tap", "35", "35")

    def test_return_rejects_missing_or_disabled_control(self):
        for root in (ui(reading=False), ElementTree.fromstring('<hierarchy><node text="Volver a la estantería" enabled="false" bounds="[1,1][5,5]"/></hierarchy>')):
            with self.subTest(root=root), self.assertRaisesRegex(AssertionError, "return-to-bookshelf"):
                verifier.return_to_bookshelf(root)

    def test_independent_verification_requires_the_fixture_artifact(self):
        with patch.object(verifier.Path, "is_file", return_value=False), patch.object(verifier, "run") as run:
            with self.assertRaisesRegex(AssertionError, "same build run"):
                verifier.verify_reading_display()
        run.assert_not_called()

    def test_real_document_stays_open_across_home_and_resume(self):
        with patch.object(verifier, "wait_for_reading_display", return_value=ui()) as wait, patch.object(verifier, "return_to_bookshelf") as back, patch.object(verifier, "run") as run:
            verifier.verify_loaded_reader_display("reading", background=True)
        self.assertEqual(wait.call_args_list, [
            unittest.mock.call("reading-reader", reading=True, initial_import_title="Intent reading"),
            unittest.mock.call("background", reading=False, foreground=False),
            unittest.mock.call("resumed-reader", reading=True),
            unittest.mock.call("reading-shelf-after", reading=False, timeout=120),
        ])
        self.assertEqual(run.call_args_list, [
            unittest.mock.call("adb", "shell", "input", "keyevent", "KEYCODE_HOME"),
            unittest.mock.call("adb", "shell", "am", "start", "-n", "com.inhousesoftware.read/.MainActivity"),
        ])
        back.assert_called_once()

    def test_resume_must_preserve_the_document_title(self):
        with patch.object(verifier, "wait_for_reading_display", return_value=ui()) as wait, patch.object(verifier, "run"), patch.object(verifier, "return_to_bookshelf") as back:
            with self.assertRaisesRegex(AssertionError, "lost the loaded document"):
                verifier.verify_loaded_reader_display("different-document", background=True)
        back.assert_not_called()


if __name__ == "__main__":
    unittest.main()
