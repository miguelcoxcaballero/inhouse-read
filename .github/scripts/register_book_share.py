"""Register «Compartir»: the book file goes to Android's share sheet through the app's FileProvider."""
from pathlib import Path

SOURCE = Path("android/book-share/BookShare.java")
# Written by the streak widget registration; the share bridge goes next to it.
BRIDGE_JAVA = 'webView.addJavascriptInterface(new StreakWidgetBridge(this, webView), "InhouseStreak");'
SHARE_JAVA = 'webView.addJavascriptInterface(new BookShare.Bridge(this, webView), "InhouseBookShare");'
# The ".fileprovider" paths the builder writes (never the updater's own inhouse_update_paths.xml).
PATHS_XML = "res/xml/file_paths.xml"
SHARED_PATH = '<cache-path name="shared" path="shared/" />'


def register_book_share(project_dir: Path, package_id: str, repo_root: Path):
    root = project_dir / "android/app/src/main"
    java_dir = root / "java" / Path(*package_id.split("."))
    (java_dir / "BookShare.java").write_text(
        (repo_root / SOURCE).read_text(encoding="utf-8").replace("__PACKAGE__", package_id), encoding="utf-8")

    activity = java_dir / "MainActivity.java"
    if not activity.exists():
        raise RuntimeError("Generated MainActivity.java is missing")
    text = activity.read_text(encoding="utf-8")
    if text.count(BRIDGE_JAVA) != 1:
        raise RuntimeError(f"MainActivity anchor not found exactly once: {BRIDGE_JAVA}")
    if SHARE_JAVA not in text:
        text = text.replace(BRIDGE_JAVA, BRIDGE_JAVA + "\n        " + SHARE_JAVA, 1)
    activity.write_text(text, encoding="utf-8")

    paths = root / PATHS_XML
    if not paths.exists():
        raise RuntimeError(f"{PATHS_XML} is missing")
    xml = paths.read_text(encoding="utf-8")
    if SHARED_PATH not in xml:
        if xml.count("</paths>") != 1:
            raise RuntimeError(f"{PATHS_XML} has no single </paths>")
        xml = xml.replace("</paths>", "    " + SHARED_PATH + "\n</paths>", 1)
    paths.write_text(xml, encoding="utf-8")
