#!/usr/bin/env python3
"""Contracts of the generated Android shell: the small loader in the APK and
the MainActivity the builder writes (Java and Kotlin templates)."""

import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOADER = REPO / ".github" / "android" / "app-loader.html"
BUILDER = REPO / "android" / "html_to_apk_builder.py"
PACKAGE = "com.inhousesoftware.read"


class Value:
    def __init__(self, value):
        self.value = value

    def get(self):
        return self.value


def builder():
    spec = importlib.util.spec_from_file_location("inhouse_apk_builder_test", BUILDER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = object.__new__(module.ApkBuilderApp)
    app.log = lambda message, tag=None: None
    app.version_name = Value("1.1.4")
    return app


def generated(language):
    """MainActivity as the builder writes it over Capacitor's template."""
    with tempfile.TemporaryDirectory() as temp:
        project = Path(temp)
        folder = "java" if language == "java" else "kotlin"
        name = "MainActivity.java" if language == "java" else "MainActivity.kt"
        target = project / "android" / "app" / "src" / "main" / folder / Path(*PACKAGE.split(".")) / name
        target.parent.mkdir(parents=True)
        target.write_text("placeholder", encoding="utf-8")
        builder().patch_webview_bridge(project, PACKAGE)
        return target.read_text(encoding="utf-8")


class LoaderTest(unittest.TestCase):
    loader = LOADER.read_text(encoding="utf-8")

    def test_is_a_small_redirect_to_the_published_app(self):
        self.assertLess(len(LOADER.read_bytes()), 3000)
        self.assertIn("https://miguelcoxcaballero.github.io/inhouse-read/?inhouse_app=1&t=", self.loader)
        self.assertIn("location.replace", self.loader)

    def test_navigates_at_once_without_waiting_for_frames(self):
        script = self.loader[self.loader.index("<script>"):self.loader.index("</script>")]
        self.assertNotIn("requestAnimationFrame", script)
        self.assertNotIn("setTimeout", script)
        self.assertTrue(re.search(r"^\s*window\.location\.replace\(", script, re.M))

    def test_keeps_the_boot_colours_of_the_native_window(self):
        self.assertIn("#f5f5f0", self.loader)
        self.assertIn("#151515", self.loader)


class MainActivityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = {language: generated(language) for language in ("java", "kotlin")}

    def test_back_at_the_shelf_keeps_the_activity_and_webview_alive(self):
        for language, source in self.sources.items():
            with self.subTest(language=language):
                self.assertIn("OnBackPressedCallback", source)
                self.assertIn("moveTaskToBack(true)", source)
                self.assertNotRegex(source, r"\bfinish\(\)")
                self.assertNotIn("onBackPressed()", source)
                # Only a page that is not the app (Google sign-in) goes back.
                self.assertRegex(source, r"!isTrustedReadPage\(\) && view\.canGoBack\(\)")

    def test_back_callback_is_registered_after_capacitor(self):
        for language, source in self.sources.items():
            with self.subTest(language=language):
                create = source.index("onCreate(")
                self.assertGreater(source.index("super.onCreate(savedInstanceState)"), create)
                self.assertGreater(source.index("OnBackPressedDispatcher" if language == "java" else "onBackPressedDispatcher"),
                                   source.index("super.onCreate(savedInstanceState)"))

    def test_renderer_stays_important_in_the_background(self):
        for language, source in self.sources.items():
            with self.subTest(language=language):
                self.assertIn("setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)", source)
                self.assertIn("Build.VERSION_CODES.O", source)

    def test_keeps_login_import_reading_voices_updates_insets_and_refresh_rate(self):
        for language, source in self.sources.items():
            with self.subTest(language=language):
                for feature in ("handleAppCallback", "handleInhouseNativeOAuth", "openAuthUrl",
                                "setReadingMode", "setReaderOwnership", "InhouseSpeech", "InhousePcm",
                                "InhouseInference", "installAppUpdate", "setOnApplyWindowInsetsListener",
                                "applyHighRefreshRate", "preferredDisplayModeId",
                                "getSafeTopInset", "setStatusBarAppearance"):
                    self.assertIn(feature, source, feature)

    def test_status_bar_overlays_the_page_without_resizing_it(self):
        # The page reserves the stable inset itself; the native parent pads
        # only sides and bottom, in reading and on the shelf alike.
        for language, source in self.sources.items():
            with self.subTest(language=language):
                listener = source[source.index("setOnApplyWindowInsetsListener("):source.index(".setInsets(safeTypes, Insets.NONE)")]
                self.assertNotIn("safeInsets.top", listener)
                self.assertNotIn("isReadingDisplayActive", listener)
                self.assertRegex(listener, r"initial(Top|Padding\.top),\n")
                self.assertIn("updateSafeTopInset(windowInsets)", listener)
                self.assertIn("getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars())", source)
                self.assertIn("LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS", source)
                self.assertRegex(source, r"setStatusBarColor\(Color\.TRANSPARENT\)|statusBarColor = Color\.TRANSPARENT")
                self.assertRegex(source, r"setNavigationBarColor\(bootColor\)|navigationBarColor = bootColor")
                self.assertIn("import android.graphics.Color", source)

    def test_page_hooks_are_called_only_for_the_trusted_page(self):
        for language, source in self.sources.items():
            with self.subTest(language=language):
                push = source[source.index("updateSafeTopInset(WindowInsetsCompat") if language == "java"
                              else source.index("updateSafeTopInset(windowInsets: WindowInsetsCompat"):]
                push = push[:push.index("evaluateJavascript")]
                self.assertIn("isTrustedReadPage()", push)
                setter = source[source.index("setStatusBarAppearance(boolean" if language == "java"
                                             else "setStatusBarAppearance(lightBackground: Boolean"):]
                setter = setter[:setter.index("applyStatusBarAppearance()")]
                self.assertIn("runOnUiThread", setter)
                self.assertIn("isTrustedReadPage()", setter)

    def test_keeps_the_anchors_register_book_imports_rewrites(self):
        anchors = {
            "java": ["private ReadAloudBridge speechBridge;", "if (speechBridge != null) speechBridge.close();",
                     "handleAppCallback(intent);", "handleAppCallback(getIntent());"],
            "kotlin": ["private var speechBridge: ReadAloudBridge? = null", "speechBridge?.close()",
                       "setIntent(intent)\n        handleAppCallback(intent)",
                       'webView.addJavascriptInterface(InhouseNativeBridge(), "InhouseNative")',
                       "handleAppCallback(intent)\n    }\n\n    inner class"],
        }
        for language, source in self.sources.items():
            for anchor in anchors[language]:
                with self.subTest(language=language, anchor=anchor):
                    self.assertIn(anchor, source)

    def test_kotlin_and_java_braces_are_balanced(self):
        for language, source in self.sources.items():
            with self.subTest(language=language):
                self.assertEqual(source.count("{"), source.count("}"))
                self.assertEqual(source.count("("), source.count(")"))


if __name__ == "__main__":
    unittest.main()
