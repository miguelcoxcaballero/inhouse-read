#!/usr/bin/env python3
"""Parser and lifecycle contracts for the real Android window verifier."""

import unittest
import subprocess
import tempfile
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
            unittest.mock.call("reading-reader", reading=True),
            unittest.mock.call("background", reading=False, foreground=False),
            unittest.mock.call("resumed-reader", reading=True),
            unittest.mock.call("reading-shelf-after", reading=False),
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
