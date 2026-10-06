#!/usr/bin/env python3
"""Run the actual Java presentation-delay method with deterministic track timestamps.

Only Android's timestamp provider and monotonic clock are substituted. No
copy of the production delay calculation is used in the harness.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "android" / "NativePcmService.java"


def java_tool(name):
    home = os.environ.get("JAVA_HOME")
    return str(Path(home) / "bin" / (name + (".exe" if os.name == "nt" else ""))) if home else name


class NativePcmClockTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = SOURCE.read_text(encoding="utf-8")
        start = source.index("private void updateOutputDelay(long head)")
        opening = source.index("{", start)
        depth, end = 1, opening + 1
        while depth:
            depth += (source[end] == "{") - (source[end] == "}")
            end += 1
        method = source[start:end]
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        folder = Path(cls.temp.name)
        harness = '''
public class PcmClockHarness {
    static class System { static long nanoTime() { return 1000000000L; } }
    static class AudioTimestamp { long framePosition, nanoTime; }
    static class Track {
        boolean available = true;
        long frames, time;
        boolean getTimestamp(AudioTimestamp s) {
            s.framePosition = frames; s.nanoTime = time; return available;
        }
    }
    final AudioTimestamp stamp = new AudioTimestamp();
    Track track = new Track();
    int rate = 24000;
    long outputDelay;
''' + method + '''
    public static void main(String[] args) {
        PcmClockHarness c = new PcmClockHarness();
        c.outputDelay = Long.parseLong(args[0]);
        c.track.frames = Long.parseLong(args[2]);
        c.track.time = Long.parseLong(args[3]);
        c.track.available = Boolean.parseBoolean(args[4]);
        c.updateOutputDelay(Long.parseLong(args[1]));
        java.lang.System.out.println(c.outputDelay);
    }
}
'''
        (folder / "PcmClockHarness.java").write_text(harness, encoding="utf-8")
        subprocess.run([java_tool("javac"), "PcmClockHarness.java"], cwd=folder, check=True, capture_output=True)

    def delay(self, old, head, frames, time=1000000000, available=True):
        result = subprocess.run([java_tool("java"), "-cp", self.temp.name, "PcmClockHarness",
                                 str(old), str(head), str(frames), str(time), str(available).lower()],
                                check=True, capture_output=True, text=True)
        return int(result.stdout.strip())

    def test_drained_track_releases_the_final_completion(self):
        # Head stops at 24,000; a valid extrapolated timestamp moves beyond it.
        self.assertEqual(self.delay(2400, 24000, 24000, 900000000), 0)

    def test_exact_presentation_does_not_keep_a_stale_delay(self):
        self.assertEqual(self.delay(2400, 24000, 24000), 0)

    def test_output_still_in_flight_keeps_its_measured_delay(self):
        self.assertEqual(self.delay(2400, 24000, 21600), 2400)
        self.assertEqual(self.delay(0, 24000, 21600), 2400)

    def test_positive_delay_changes_are_smoothed(self):
        self.assertEqual(self.delay(2400, 24000, 19200), 2700)

    def test_implausible_timestamp_is_not_trusted(self):
        self.assertEqual(self.delay(2400, 24000, 48001), 2400)
        self.assertEqual(self.delay(2400, 24000, -1), 2400)

    def test_unavailable_timestamp_preserves_the_current_measurement(self):
        self.assertEqual(self.delay(2400, 24000, 24000, available=False), 2400)

    def test_reset_and_flush_clear_the_track_specific_delay(self):
        source = SOURCE.read_text(encoding="utf-8")
        reset = source[source.index("private void resetTrack"):source.index("private void fail")]
        flush = source[source.index("void truncate"):source.index("private void updateHead")]
        self.assertRegex(reset, r"outputDelay\s*=\s*0")
        self.assertRegex(flush, r"outputDelay\s*=\s*0")


if __name__ == "__main__":
    unittest.main()
