#!/usr/bin/env python3
"""Observe real neural PCM in the signed release APK, including locked chapters.

No WebView debugging, synthetic PCM, model bypass, JS injection, or modified APK.
The separate sender supplies only an original multi-chapter EPUB. All speech
comes from the selected Piper voice downloaded through the production UI.
"""
import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from verify_android_app import run, capture, open_fixture_document, node_text, return_to_bookshelf

PACKAGE = "com.inhousesoftware.read"
PREFIX = "android-background-"
history = []
LESSAC_DOWNLOAD_PATTERN = r"^Descargar la voz Lessac,\s"

def labels(root):
    return [(n, (n.get("content-desc", "") or n.get("text", "")).strip()) for n in root.iter("node")]

def tap(root, pattern, *, require_button=False, within_voice_catalog=False):
    parents = {child: parent for parent in root.iter() for child in parent} if within_voice_catalog else {}
    for node, label in labels(root):
        if node.get("enabled") != "true" or not re.search(pattern, label, re.I):
            continue
        if (require_button or within_voice_catalog) and (node.get("class") != "android.widget.Button" or node.get("clickable") != "true"):
            continue
        box = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if not box:
            continue
        x1, y1, x2, y2 = map(int, box.groups())
        if x2 <= x1 or y2 <= y1:
            continue
        if within_voice_catalog:
            # Accessibility can still expose the initial offer after opening
            # the catalog, even when its bounds lie above the visible dialog.
            dialog = catalog = None
            ancestor = parents.get(node)
            while ancestor is not None:
                name = (ancestor.get("content-desc", "") or ancestor.get("text", "")).strip()
                if ancestor.get("enabled") == "true":
                    if ancestor.get("class") == "android.app.Dialog" and name == "Escuchar":
                        dialog = ancestor
                    elif ancestor.get("class") == "android.view.View" and name == "Voces naturales":
                        catalog = ancestor
                ancestor = parents.get(ancestor)
            if dialog is None or catalog is None:
                continue
            containers = [re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", item.get("bounds", "")) for item in (dialog, catalog)]
            if any(item is None for item in containers):
                continue
            if not all(left <= x1 < x2 <= right and top <= y1 < y2 <= bottom for left, top, right, bottom in (map(int, item.groups()) for item in containers)):
                continue
        run("adb", "shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))
        return label
    return None

def ui_action(label, pattern, timeout=45, *, require_button=False, within_voice_catalog=False):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        root = capture(Path(PREFIX+label+".png"), Path(PREFIX+label+".xml"))
        used = tap(root, pattern, require_button=require_button, within_voice_catalog=within_voice_catalog)
        if used:
            history.append({"action": label, "control": used, "at": time.time()})
            return root
        time.sleep(2)
    raise AssertionError(f"Actual APK control missing: {label}/{pattern}: {node_text(root)[:2000]}")

def logs():
    raw = run("adb", "logcat", "-d", "-v", "threadtime", "InhousePcm:I", "InhousePcmState:I", "InhousePcmProgress:I", "*:S").stdout
    Path(PREFIX+"logcat.txt").write_text(raw, encoding="utf-8")
    states, events, progress = [], [], []
    for line in raw.splitlines():
        matched = re.search(r"\b(InhousePcmState|InhousePcmProgress|InhousePcm)\s*:\s*(\{.*\})$", line)
        if not matched:
            continue
        value = json.loads(matched.group(2))
        {"InhousePcmState": states, "InhousePcm": events, "InhousePcmProgress": progress}[matched.group(1)].append(value)
    return raw, states, events, progress

def wait_state(predicate, label, timeout=45):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        raw, states, events, progress = logs()
        if states and predicate(states[-1], events, progress):
            history.append({"state": label, "value": states[-1], "at": time.time()})
            return states[-1]
        time.sleep(1)
    raise AssertionError(f"Native AudioTrack did not reach {label}: {states[-3:]}")

def notification_action(label, pattern):
    run("adb", "shell", "cmd", "statusbar", "expand-notifications")
    ui_action(label, pattern, 20)
    run("adb", "shell", "cmd", "statusbar", "collapse")

def assert_released(label):
    wait_state(lambda s,e,p: not s["active"] and not s["wakeHeld"], label)
    end = time.monotonic()+15
    while True:
        services=run("adb", "shell", "dumpsys", "activity", "services", PACKAGE).stdout
        power=run("adb", "shell", "dumpsys", "power").stdout
        Path(PREFIX+label+"-services.txt").write_text(services,encoding="utf-8")
        Path(PREFIX+label+"-power.txt").write_text(power,encoding="utf-8")
        if not re.search(r"ServiceRecord\{[^\n]*NativePcmService", services):
            assert not re.search(r'PARTIAL_WAKE_LOCK[^\n]*InhouseRead:Audiobook', power), "Native CPU wake lock survived Stop"
            return
        if time.monotonic()>=end:
            raise AssertionError("Native media service survived Stop/reader close")
        time.sleep(1)

def locked_metrics(raw, states, events, progress, session):
    locked=[s for s in states if s.get("session")==session and s.get("interactive") is False and s.get("active")]
    assert locked, "No native rendered-frame observations while display locked"
    assert all(s.get("wakeHeld") for s in locked), "CPU wake lock dropped while natural audio was active"
    assert locked[-1]["elapsedMs"]-locked[0]["elapsedMs"] >= 360_000, "Locked playback did not cover six real minutes"
    by_epoch={}
    for s in locked:
        previous=by_epoch.get(s["epoch"])
        if previous:
            assert s["playedFrames"] >= previous["playedFrames"], "AudioTrack rendered frame count went backwards"
        by_epoch[s["epoch"]]=s
    audio_seconds=sum(s["playedFrames"]/s["sampleRate"] for s in by_epoch.values() if s["sampleRate"])
    assert audio_seconds >= 180, f"Locked output did not render enough real PCM: {audio_seconds} seconds"
    chapters=sorted({p["chapter"] for p in progress if p.get("session")==session and p.get("kind")=="chapter" and p.get("interactive") is False})
    assert len(chapters)>=3 and chapters[-1]>chapters[0], f"Worker/reader did not cross real EPUB spine chapters while locked: {chapters}"
    started={e["unit"] for e in events if e.get("session")==session and e.get("type")=="start"}
    ended={e["unit"] for e in events if e.get("session")==session and e.get("type")=="done"}
    assert len(started)>=12 and len(ended)>=11, "Natural sentence pipeline stopped while locked"
    errors=[e for e in events if e.get("session")==session and e.get("type")=="error"]
    assert not errors, f"Native pipeline reported errors: {errors}"
    audible=re.findall(r"enqueue session="+re.escape(session)+r"[^\n]*peak=([\d.Ee+-]+) rms=([\d.Ee+-]+)",raw)
    assert audible and max(float(p) for p,r in audible)>.05 and max(float(r) for p,r in audible)>.001, "Neural PCM was silent"
    return {"lockedWallMs":locked[-1]["elapsedMs"]-locked[0]["elapsedMs"],"renderedAudioSeconds":audio_seconds,"chapters":chapters,"startedUnits":len(started),"endedUnits":len(ended),"errors":errors}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk")
    args=parser.parse_args()
    result={"status":"failed","apkSha256":hashlib.sha256(Path(args.apk).read_bytes()).hexdigest(),"startedAt":time.time(),"actions":history}
    try:
        run("adb","install","-r",args.apk)
        run("adb","install","-r","intent-fixture-debug.apk")
        run("adb","logcat","-G","16M");run("adb","logcat","-c")
        open_fixture_document("audiobook")
        ui_action("audio",r"^Escuchar el libro$")
        ui_action("voices",r"^Voz(?:\s|$)",require_button=True)
        ui_action("download",LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True)
        # The exact real installed row replaces Download; no forced install API.
        end=time.monotonic()+600
        while True:
            root=capture(Path(PREFIX+"installed.png"),Path(PREFIX+"installed.xml"))
            if any(re.search(r"^(Voz en uso|Usar la voz) Lessac\b",label) for n,label in labels(root)):
                if not any(re.search(r"^Voz en uso Lessac\b",label) for n,label in labels(root)):
                    assert tap(root,r"^Usar la voz Lessac\b")
                break
            assert time.monotonic()<end, "Real Piper voice download did not finish"
            time.sleep(3)
        # Return from dropdown; Play remains inside the audio panel.
        run("adb","shell","input","keyevent","KEYCODE_ESCAPE")
        ui_action("play",r"^Reproducir$")
        first=wait_state(lambda s,e,p:s["active"] and s["playedFrames"]>0 and any(x.get("type")=="start" for x in e),"audible-start",120)
        ui_action("panel-close",r"^Cerrar opciones de lectura$")
        run("adb","shell","input","keyevent","KEYCODE_SLEEP")
        wait_state(lambda s,e,p:s["interactive"] is False and s["active"],"screen-locked")
        until=time.monotonic()+365
        while time.monotonic()<until:
            _,states,events,progress=logs()
            assert states[-1]["active"] and states[-1]["wakeHeld"] and states[-1]["interactive"] is False, "Locked audiobook stopped or display woke unexpectedly"
            assert not any(e.get("type")=="error" for e in events), "Native audio error while locked"
            time.sleep(5)
        raw,states,events,progress=logs()
        result["lockedPlayback"]=locked_metrics(raw,states,events,progress,first["session"])
        run("adb","shell","input","keyevent","KEYCODE_WAKEUP");run("adb","shell","wm","dismiss-keyguard")
        notification_action("notification-pause",r"^(Pausar|Pause)$")
        wait_state(lambda s,e,p:not s["active"] and not s["wakeHeld"],"paused")
        notification_action("notification-resume",r"^(Continuar|Play|Reproducir)$")
        resumed=wait_state(lambda s,e,p:s["active"] and s["playedFrames"]>0 and s["session"]!=first["session"],"resumed",120)
        notification_action("notification-stop",r"^(Detener|Stop)$")
        assert_released("stopped")
        run("adb","shell","am","start","-W","-n",PACKAGE+"/.MainActivity")
        ui_action("audio-again",r"^Escuchar el libro$");ui_action("play-again",r"^Reproducir$")
        wait_state(lambda s,e,p:s["active"] and s["playedFrames"]>0 and s["session"]!=resumed["session"],"playing-again",120)
        ui_action("panel-close-again",r"^Cerrar opciones de lectura$")
        notification_action("pause-before-close",r"^(Pausar|Pause)$")
        wait_state(lambda s,e,p:not s["active"] and not s["wakeHeld"],"paused-before-close")
        root=capture(Path(PREFIX+"reader-before-close.png"),Path(PREFIX+"reader-before-close.xml"));return_to_bookshelf(root)
        assert_released("closed-while-paused")
        # Same signed APK and installed Piper; real PDF display staging must
        # also finish with document.hidden, not just an EPUB spine animation.
        open_fixture_document("backgroundpdf")
        ui_action("pdf-audio",r"^Escuchar el libro$")
        ui_action("pdf-language",r"^Idioma(?:\s|$)",require_button=True)
        ui_action("pdf-english",r"^Ingl[eé]s(?:\s|$)")
        ui_action("pdf-voices",r"^Voz(?:\s|$)",require_button=True)
        ui_action("pdf-lessac",r"^(Usar la voz|Voz en uso) Lessac\b")
        run("adb","shell","input","keyevent","KEYCODE_ESCAPE")
        ui_action("pdf-play",r"^Reproducir$")
        pdf=wait_state(lambda s,e,p:s["active"] and s["playedFrames"]>0 and any(x.get("kind")=="page" and x.get("session")==s["session"] for x in p),"pdf-audible",120)
        ui_action("pdf-panel-close",r"^Cerrar opciones de lectura$")
        run("adb","shell","input","keyevent","KEYCODE_SLEEP")
        wait_state(lambda s,e,p:s["interactive"] is False and s["active"],"pdf-screen-locked")
        end=time.monotonic()+180
        while True:
            raw,states,events,progress=logs()
            pages=sorted({x["chapter"] for x in progress if x.get("session")==pdf["session"] and x.get("kind")=="page" and x.get("interactive") is False})
            assert not any(x.get("type")=="error" and x.get("session")==pdf["session"] for x in events), "Hidden PDF audio failed"
            if len(pages)>=2:
                result["lockedPdf"]={"pages":pages,"starts":sum(x.get("type")=="start" and x.get("session")==pdf["session"] for x in events),"nativeState":states[-1]}
                break
            assert time.monotonic()<end, f"Hidden real PDF did not cross two audible physical pages: {pages}"
            time.sleep(2)
        run("adb","shell","input","keyevent","KEYCODE_WAKEUP");run("adb","shell","wm","dismiss-keyguard")
        notification_action("pdf-notification-stop",r"^(Detener|Stop)$")
        assert_released("pdf-stopped")
        result["status"]="passed"
    except Exception as error:
        result["error"]=str(error)
        raise
    finally:
        logs();result["finishedAt"]=time.time()
        Path(PREFIX+"certification.json").write_text(json.dumps(result,indent=2),encoding="utf-8")

if __name__=="__main__":main()
