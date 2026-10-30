#!/usr/bin/env python3
"""Contracts of the generated Android shell: the small loader in the APK and
the MainActivity the builder writes (Java and Kotlin templates)."""

import importlib.util
import json
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

    def test_the_root_listener_owns_the_insets_and_keeps_the_keyboard_spacing(self):
        # Capacitor's SystemBars inset handling is off (capacitor.config.json),
        # so this listener also gives the keyboard the room the plugin gave it.
        for language, source in self.sources.items():
            with self.subTest(language=language):
                listener = source[source.index("setOnApplyWindowInsetsListener("):source.index(".setInsets(safeTypes, Insets.NONE)")]
                self.assertIn("isVisible(WindowInsetsCompat.Type.ime())", listener)
                self.assertIn("getInsets(WindowInsetsCompat.Type.ime()).bottom", listener)
                self.assertIn("keyboardKeepsNavigationInset", listener)
                self.assertRegex(listener, r"initial(Bottom|Padding\.bottom) \+ bottomInset\)")
                self.assertRegex(source, r"keyboardKeepsNavigationInset = webViewMajorVersion\(\) >= 144")
                self.assertIn("WebView.getCurrentWebViewPackage()", source)
                update = source[source.index("updateSafeTopInset(WindowInsetsCompat") if language == "java"
                                else source.index("updateSafeTopInset(windowInsets: WindowInsetsCompat"):]
                update = update[:update.index("density")]
                # Status bar ignoring visibility, plus all the top the shell padded before.
                self.assertIn("getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars()).top", update)
                self.assertRegex(update, r"getInsets\(WindowInsetsCompat\.Type\.systemBars\(\) (\||or) WindowInsetsCompat\.Type\.displayCutout\(\)\)\.top")

    def test_capacitor_system_bars_do_not_pad_the_window(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            html = project / "index.html"
            html.write_text("<script>location.replace('https://miguelcoxcaballero.github.io/inhouse-read/')</script>", encoding="utf-8")
            builder().write_node_project(project, "Inhouse Read", PACKAGE, html)
            config = json.loads((project / "capacitor.config.json").read_text(encoding="utf-8"))
        self.assertEqual(config["plugins"]["SystemBars"]["insetsHandling"], "disable")
        self.assertIn("miguelcoxcaballero.github.io", config["server"]["allowNavigation"])

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


class ReadingFocusTest(unittest.TestCase):
    REPO = Path(__file__).resolve().parents[2]

    def test_the_rule_follows_the_reader_display(self):
        from register_reading_focus import BRIDGE_JAVA, DISPLAY_JAVA
        builder = (self.REPO / "android/html_to_apk_builder.py").read_text(encoding="utf-8")
        # The anchors the registration patches exist once in the generated MainActivity.
        self.assertEqual(builder.count(DISPLAY_JAVA), 1)
        # The streak widget registration writes the bridge line this one follows.
        streak = (self.REPO / ".github/scripts/register_streak_widget.py").read_text(encoding="utf-8")
        self.assertIn(BRIDGE_JAVA.removeprefix("webView.addJavascriptInterface(").rstrip(");"), streak)

    def test_reading_audio_alarms_and_calls_still_get_through(self):
        java = (self.REPO / "android/reading-focus/ReadingFocus.java").read_text(encoding="utf-8")
        for rule in (".allowMedia(true)", ".allowAlarms(true)", ".allowCalls(ZenPolicy.PEOPLE_TYPE_ANYONE)",
                     ".showPeeking(false)", ".showInNotificationList(true)"):
            with self.subTest(rule=rule):
                self.assertIn(rule, java)
        self.assertIn("trustedPage()", java)


class BookShareTest(unittest.TestCase):
    REPO = Path(__file__).resolve().parents[2]
    JAVA = (REPO / "android/book-share/BookShare.java").read_text(encoding="utf-8")

    def project(self, temp):
        from register_book_share import BRIDGE_JAVA
        root = Path(temp) / "android/app/src/main"
        java_dir = root / "java" / Path(*PACKAGE.split("."))
        java_dir.mkdir(parents=True)
        (java_dir / "MainActivity.java").write_text(f"class MainActivity {{\n    void bridges() {{\n        {BRIDGE_JAVA}\n    }}\n}}\n", encoding="utf-8")
        (root / "res/xml").mkdir(parents=True)
        (root / "res/xml/file_paths.xml").write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <cache-path name="updates" path="updates/" />\n</paths>\n', encoding="utf-8")
        return root, java_dir

    def test_registers_the_bridge_once_and_serves_cache_shared_through_the_app_provider(self):
        from register_book_share import SHARE_JAVA, register_book_share
        with tempfile.TemporaryDirectory() as temp:
            root, java_dir = self.project(temp)
            for _ in range(2):
                register_book_share(Path(temp), PACKAGE, self.REPO)
            activity = (java_dir / "MainActivity.java").read_text(encoding="utf-8")
            self.assertEqual(activity.count(SHARE_JAVA), 1)
            self.assertIn('"InhouseBookShare"', activity)
            share = (java_dir / "BookShare.java").read_text(encoding="utf-8")
            self.assertTrue(share.startswith(f"package {PACKAGE};"))
            paths = (root / "res/xml/file_paths.xml").read_text(encoding="utf-8")
            self.assertEqual(paths.count('<cache-path name="shared" path="shared/" />'), 1)
            self.assertIn('<cache-path name="updates" path="updates/" />', paths)
            ElementTree = __import__("xml.etree.ElementTree", fromlist=["parse"])
            ElementTree.parse(root / "res/xml/file_paths.xml")

    def test_the_streak_widget_writes_the_anchor_it_follows(self):
        from register_book_share import BRIDGE_JAVA
        streak = (self.REPO / ".github/scripts/register_streak_widget.py").read_text(encoding="utf-8")
        self.assertIn(BRIDGE_JAVA.removeprefix("webView.addJavascriptInterface(").rstrip(");"), streak)

    def test_shares_the_file_with_the_system_chooser_from_the_trusted_page_only(self):
        for begin_or_finish in ("public String begin(", "public boolean finish("):
            with self.subTest(method=begin_or_finish):
                body = self.JAVA.split(begin_or_finish)[1].split("@JavascriptInterface")[0]
                self.assertIn("trustedPage()", body)
        for piece in ("Intent.ACTION_SEND", "Intent.EXTRA_STREAM", "Intent.FLAG_GRANT_READ_URI_PERMISSION",
                      "Intent.createChooser(", "Intent.EXTRA_EXCLUDE_COMPONENTS", 'getPackageName() + ".fileprovider"',
                      'new File(activity.getCacheDir(), "shared")', "Base64.decode(", 'startsWith("/inhouse-read/")'):
            with self.subTest(piece=piece):
                self.assertIn(piece, self.JAVA)
        # Pieces and the chooser belong to the session begin() returned: two shares never mix.
        for method in ("public boolean append(String id, String base64)", "public boolean finish(String id)"):
            with self.subTest(method=method):
                self.assertIn("current(id)", self.JAVA.split(method)[1].split("@JavascriptInterface")[0])
        # The frozen updater keeps its own provider; sharing never uses it.
        self.assertNotIn("update-provider", self.JAVA)
        self.assertNotIn("UpdateFileProvider", self.JAVA)
        self.assertEqual(self.JAVA.count("{"), self.JAVA.count("}"))
        self.assertEqual(self.JAVA.count("("), self.JAVA.count(")"))


class StreakWidgetTest(unittest.TestCase):
    ROOT = Path(__file__).resolve().parents[2] / "android/streak-widget"

    def test_resources_are_valid_xml(self):
        from xml.etree import ElementTree
        files = list((self.ROOT / "res").rglob("*.xml"))
        self.assertGreater(len(files), 8)
        for file in files:
            with self.subTest(file=file.name):
                ElementTree.parse(file)

    def test_java_uses_only_existing_resources(self):
        import re
        java = "".join((self.ROOT / name).read_text(encoding="utf-8")
                       for name in ("StreakWidgetProvider.java", "StreakWidgetBridge.java"))
        layout = "".join(path.read_text(encoding="utf-8") for path in (self.ROOT / "res/layout").glob("*.xml"))
        drawables = {path.stem for path in (self.ROOT / "res/drawable").glob("*.xml")}
        for kind, name in set(re.findall(r"R\.(id|drawable|layout)\.(\w+)", java)):
            with self.subTest(resource=f"{kind}.{name}"):
                if kind == "id":
                    self.assertIn(f'@+id/{name}"', layout)
                elif kind == "drawable":
                    self.assertIn(name, drawables)
                else:
                    self.assertTrue((self.ROOT / f"res/layout/{name}.xml").exists())

    def test_every_size_has_its_layout(self):
        layouts = {path.stem for path in (self.ROOT / "res/layout").glob("*.xml")}
        self.assertEqual(layouts, {"streak_widget_tiny", "streak_widget_row", "streak_widget_small",
                                   "streak_widget_medium", "streak_widget", "streak_widget_wide"})
        info = (self.ROOT / "res/xml/streak_widget_info.xml").read_text(encoding="utf-8")
        # Hasta 1×1: 40 dp es una celda en la fórmula de Android (70 × n − 30).
        self.assertIn('android:minResizeWidth="40dp"', info)
        self.assertIn('android:minResizeHeight="40dp"', info)
        for name in layouts:
            with self.subTest(layout=name):
                text = (self.ROOT / f"res/layout/{name}.xml").read_text(encoding="utf-8")
                self.assertIn('@+id/streak_widget_root', text)
                self.assertIn('@drawable/streak_widget_logo', text)

    def test_bridge_checks_the_page_before_writing(self):
        bridge = (self.ROOT / "StreakWidgetBridge.java").read_text(encoding="utf-8")
        self.assertIn("!trustedPage()", bridge.split("public void update")[1].split("try")[0])
        self.assertIn('startsWith("/inhouse-read/")', bridge)


if __name__ == "__main__":
    unittest.main()
