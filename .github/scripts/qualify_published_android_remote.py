#!/usr/bin/env python3
"""Separate remote APK qualification. Original verifier gates remain untouched.

No APK build, WebView injection, response replacement or product source changes.
This candidate65 binding comes from actual Git/full/public HTTP/APK/loader
receipts. The original Git64 verifier scripts and signed APK are unchanged.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile

BINDING = {'arm': 'candidate', 'webVersion': '1.7.65', 'qaBaseSource': '72a785c2db0c4d65792c9008299f1445ab022d04', 'webSource': 'accce9b0a39380ef100a7f54a239f382575cc6a4', 'pages': 'ba66ce6b6c3d7905fd1d28406bbb89a5611447e0', 'repository': 'miguelcoxcaballero/inhouse-read', 'base': 'https://miguelcoxcaballero.github.io/inhouse-read/', 'http': {'index.html': {'bytes': 10833, 'sha256': 'bdbf24be506fade2f153214d8a85ccb6b519acc22b1b073f7af1317a25e76298'}, 'assets/main-B5HqGAXd.js': {'bytes': 1458802, 'sha256': '2288429bbef08b70c0b1235fdd32e03db17206b5bbff06563bd82d44028544aa'}}, 'apk': {'version': '1.1.4', 'versionCode': 17, 'bytes': 78515243, 'sha256': 'feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191', 'url': 'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/android-v1.1.4/inhouse-read-release-v1.1.4.apk'}, 'loader': {'bytes': 2089, 'sha256': '8e03c3a6c8f840d9e9cf66637babe2d63742d2948d852534b865db0086aa9f34'}, 'sender': {'run': '37167745832', 'artifact': 'inhouse-read-android-intent-fixture-v1.1.4', 'bytes': 2263898, 'sha256': 'c1d496fc70ea63bb662ba4545d4b20324c7d180660bad9e6fb5c78a2da1969cb'}, 'nativeOrtSha256': 'cec472b4a5798c690b893ac73c9f58c394713bc07855cb8279519184cd779d28', 'scripts': {'.github/scripts/verify_android_app.py': {'bytes': 24384, 'sha256': 'cbe8fccf3e135fa97c1da9aa799fa035868158f9ca0185e0b44e4e6235b96ee0'}, '.github/scripts/verify_android_background.py': {'bytes': 17877, 'sha256': '12f9c7d7aa91b8ebd1b4d70d10e3bceef4c983c7358864612a8d1872f7437698'}}, 'largest': {'literalBefore': 'Lessac', 'literalAfter': 'Cori', 'substitutions': 7, 'bytes': 17863, 'sha256': '9557afb06082ed723575db7785e08ec996525e1f5000b73a48ab86daaa2db28c', 'advertisedOnnxBytes': 114219352}}
CHANGED_PATHS = {".github/workflows/verify-published-android.yml", ".github/scripts/qualify_published_android_remote.py"}
ROOT = Path(__file__).resolve().parents[2]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def file_fact(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}

def same(data, expected, label):
    assert len(data) == expected["bytes"], f"{label}: size mismatch"
    assert sha(data) == expected["sha256"], f"{label}: digest mismatch"

def save(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)

def raw(source, path):
    return git("cat-file", "blob", f"{source}:{path}")

def checkout_proof():
    head = git("rev-parse", "HEAD").decode().strip()
    assert head == os.environ["GITHUB_SHA"], "Checkout is not this dispatch's SHA"
    assert os.environ["GITHUB_REPOSITORY"] == BINDING["repository"]
    assert os.environ["GITHUB_REF"].startswith("refs/heads/qa/"), "QA branch required"
    assert set(git("diff", "--name-only", BINDING["qaBaseSource"], head).decode().splitlines()) == CHANGED_PATHS
    assert not git("diff", "--name-only"), "Tracked working files changed"
    assert json.loads(raw(BINDING["webSource"], "package.json"))["version"] == BINDING["webVersion"]
    assert sha(raw(BINDING["webSource"], "src/js/readers/neural-voice/native-ort.js")) == BINDING["nativeOrtSha256"]
    scripts = {}
    for path, expected in BINDING["scripts"].items():
        data = raw(BINDING["qaBaseSource"], path)
        same(data, expected, path)
        assert raw(BINDING["webSource"], path) == data, "Published original verifier changed"
        assert (ROOT / path).read_bytes() == data, "Checkout verifier is not raw original"
        scripts[path] = expected
    return {"qaCommit": head, "qaRef": os.environ["GITHUB_REF"], "source": BINDING["webSource"], "scripts": scripts,
            "workflow": file_fact(ROOT / ".github/workflows/verify-published-android.yml"),
            "helper": file_fact(Path(__file__).resolve())}

def public_proof(out, phase):
    directory = out / (phase + "-public")
    directory.mkdir(exist_ok=False)
    endpoint = f"repos/{BINDING['repository']}/git/ref/heads/gh-pages"
    ref_raw = subprocess.check_output(["gh", "api", endpoint], cwd=ROOT)
    (directory / "pages-ref.json").write_bytes(ref_raw)
    assert json.loads(ref_raw)["object"]["sha"] == BINDING["pages"], "Live Pages moved"
    commit_raw = subprocess.check_output(["gh", "api", f"repos/{BINDING['repository']}/git/commits/{BINDING['pages']}"], cwd=ROOT)
    (directory / "pages-commit.json").write_bytes(commit_raw)
    assert json.loads(commit_raw)["message"].strip() == "deploy: " + BINDING["webSource"]
    observations = []
    for index, (path, expected) in enumerate(BINDING["http"].items()):
        url = BINDING["base"] + path + "?remoteApkQA=" + os.environ["GITHUB_RUN_ID"] + "-" + phase
        request = Request(url, headers={"Cache-Control": "no-cache"})
        with urlopen(request, timeout=60) as response:
            body = response.read()
            observation = {"url": url, "status": response.status, "headers": dict(response.headers), "bytes": len(body), "sha256": sha(body)}
        (directory / f"body-{index}.bin").write_bytes(body)
        observations.append(observation)
        save(directory / "observations.json", observations)
        assert observation["status"] == 200
        same(body, expected, path)
    return {"pages": BINDING["pages"], "source": BINDING["webSource"], "http": observations}

def inputs_proof(apk, sender):
    assert file_fact(apk) == {key: BINDING["apk"][key] for key in ("bytes", "sha256")}
    assert file_fact(sender) == {key: BINDING["sender"][key] for key in ("bytes", "sha256")}
    with ZipFile(apk) as archive:
        loader = archive.read("assets/public/index.html")
        same(loader, BINDING["loader"], "APK loader")
        assert BINDING["base"].encode() in loader
        assert b"location.replace" in loader or b"location.href" in loader
        assert archive.read("assets/public/cordova.js") == b""
        assert archive.read("assets/public/cordova_plugins.js") == b""
    return {"apk": file_fact(apk), "sender": file_fact(sender), "loader": BINDING["loader"]}

def prepare(args):
    out = args.output
    out.mkdir(exist_ok=False)
    start = {"status": "preparation-started", "scenario": args.scenario, "binding": BINDING,
             "runId": os.environ["GITHUB_RUN_ID"], "runAttempt": os.environ["GITHUB_RUN_ATTEMPT"], "startedAt": time.time()}
    save(out / "preparation.json", start)
    try:
        assert os.environ["VERSION"] == BINDING["apk"]["version"]
        assert os.environ["FIXTURE_RUN_ID"] == BINDING["sender"]["run"]
        start["checkout"] = checkout_proof()
        start["inputs"] = inputs_proof(args.apk, args.sender)
        start["public"] = public_proof(out, "before")
        work = out / "work"
        work.mkdir()
        for path, expected in BINDING["scripts"].items():
            (work / Path(path).name).write_bytes(raw(BINDING["qaBaseSource"], path))
        original = (work / "verify_android_background.py").read_bytes()
        assert original.count(b"Lessac") == 7 and b"Cori" not in original
        largest = original.replace(b"Lessac", b"Cori")
        assert largest.replace(b"Cori", b"Lessac") == original
        same(largest, BINDING["largest"], "Largest seven-substitution verifier")
        (work / "verify_android_background_largest.py").write_bytes(largest)
        largest_path = ROOT / ".github/scripts/verify_android_background_largest.py"
        assert not largest_path.exists(), "Fresh untracked largest verifier path required"
        with largest_path.open("xb") as stream:
            stream.write(largest)
        start["executedVerifierInputs"] = {str(path.relative_to(ROOT)): file_fact(path) for path in
                                         [ROOT / name for name in BINDING["scripts"]] + [largest_path]}
        shutil.copyfile(args.sender, work / "intent-fixture-debug.apk")
        start["status"] = "prepared-not-executed"
        start["workInputs"] = {p.name: file_fact(p) for p in work.iterdir() if p.is_file()}
    except BaseException as error:
        start["status"] = "failed-before-execution"
        start["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        save(out / "preparation.json", start)

def check_work(out, preparation):
    work = out / "work"
    for name, expected in preparation["workInputs"].items():
        assert file_fact(work / name) == expected, "Verifier/sender changed: " + name
    for path, expected in preparation["executedVerifierInputs"].items():
        assert file_fact(ROOT / path) == expected, "Executed verifier changed: " + path
    for path, expected in BINDING["scripts"].items():
        same((ROOT / path).read_bytes(), expected, "Executed raw original verifier: " + path)
    largest = (ROOT / ".github/scripts/verify_android_background_largest.py").read_bytes()
    same(largest, BINDING["largest"], "Executed largest verifier")
    assert largest.replace(b"Cori", b"Lessac") == (ROOT / ".github/scripts/verify_android_background.py").read_bytes()
    return work

def run(args):
    out = args.output
    preparation = json.loads((out / "preparation.json").read_text())
    assert preparation["status"] == "prepared-not-executed"
    assert preparation["scenario"] == args.scenario
    assert checkout_proof() == preparation["checkout"]
    work = check_work(out, preparation)
    result = {"status": "running", "scenario": args.scenario, "steps": [], "startedAt": time.time(),
              "scope": "Original UI/native background verifier. No WebView request observation or per-upload timing claimed."}
    save(out / "execution.json", result)
    try:
        app_verifier = ROOT / ".github/scripts/verify_android_app.py"
        background_verifier = ROOT / ".github/scripts" / ("verify_android_background_largest.py" if args.scenario == "largest" else "verify_android_background.py")
        commands = [[sys.executable, "-u", str(app_verifier), str(args.apk), "--book-imports"],
                    [sys.executable, "-u", str(background_verifier), str(args.apk)]]
        for index, command in enumerate(commands):
            entry = {"args": command, "startedAt": time.time()}
            result["steps"].append(entry)
            save(out / "execution.json", result)
            with (out / f"step-{index}.stdout.log").open("wb") as stdout, (out / f"step-{index}.stderr.log").open("wb") as stderr:
                child = subprocess.Popen(command, cwd=work, stdout=stdout, stderr=stderr)
                entry["pid"] = child.pid
                save(out / "execution.json", result)
                code = child.wait()
            entry.update(exitCode=code, finishedAt=time.time(), processClosed=True)
            save(out / "execution.json", result)
            if code != 0:
                result["status"] = "failed"
                return code
        certificate = json.loads((work / "android-background-certification.json").read_text())
        assert certificate["status"] == "passed" and certificate["apkSha256"] == BINDING["apk"]["sha256"]
        result["status"] = "passed"
        return 0
    except BaseException as error:
        result["status"] = "failed"
        result["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        result["finishedAt"] = time.time()
        save(out / "execution.json", result)

def finalize(args):
    out = args.output
    out.mkdir(exist_ok=True)
    result = {"status": "failed", "scenario": args.scenario, "finalizedAt": time.time(), "issues": []}
    try:
        preparation = json.loads((out / "preparation.json").read_text())
        result["checkoutUnchanged"] = checkout_proof() == preparation.get("checkout")
        assert result["checkoutUnchanged"]
        result["inputsUnchanged"] = inputs_proof(args.apk, args.sender) == preparation.get("inputs")
        assert result["inputsUnchanged"]
        check_work(out, preparation)
        result["publicAfter"] = public_proof(out, "after")
        execution = json.loads((out / "execution.json").read_text())
        result["execution"] = execution
        assert execution["status"] == "passed", "Original execution did not pass"
        result["status"] = "passed"
    except BaseException as error:
        result["issues"].append({"type": type(error).__name__, "message": str(error)})
    finally:
        result["files"] = {str(p.relative_to(out)): file_fact(p) for p in out.rglob("*") if p.is_file() and p.name != "summary.json"}
        save(out / "summary.json", result)
        print(json.dumps({"scenario": args.scenario, "status": result["status"], "issues": result["issues"]}))
    return 0 if result["status"] == "passed" else 1

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run", "finalize"))
    parser.add_argument("--scenario", required=True, choices=("original", "largest"))
    parser.add_argument("--output", required=True, type=lambda p: Path(p).resolve())
    parser.add_argument("--apk", required=True, type=lambda p: Path(p).resolve())
    parser.add_argument("--sender", required=True, type=lambda p: Path(p).resolve())
    args = parser.parse_args()
    return {"prepare": prepare, "run": run, "finalize": finalize}[args.action](args) or 0

if __name__ == "__main__":
    sys.exit(main())
