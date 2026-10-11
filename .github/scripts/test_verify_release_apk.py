#!/usr/bin/env python3
"""Release identity and signing checks reject invalid APK metadata."""

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import verify_release_apk as verifier


class ReleaseApkTests(unittest.TestCase):
    def setUp(self):
        self.current_identity = (verifier.PACKAGE, verifier.VERSION_CODE, verifier.VERSION_NAME)
        self.previous_identity = (verifier.PACKAGE, 26, "1.1.13")
        self.current_certificate = "a" * 64
        self.previous_certificate = self.current_certificate

    def output(self, command, **_):
        previous = command[-1] == "previous.apk"
        if command[0].endswith("apksigner"):
            digest = self.previous_certificate if previous else self.current_certificate
            return "Signer #1 certificate SHA-256 digest: " + digest
        package, code, name = self.previous_identity if previous else self.current_identity
        return f"package: name='{package}' versionCode='{code}' versionName='{name}'"

    def verify(self):
        with patch.object(subprocess, "check_output", side_effect=self.output):
            verifier.verify(Path("new.apk"), Path("previous.apk"), Path("build-tools"))

    def test_accepts_expected_release_with_same_signing_key(self):
        self.verify()

    def test_rejects_changed_signing_key(self):
        self.current_certificate = "b" * 64
        with self.assertRaisesRegex(ValueError, "signing key changed"):
            self.verify()

    def test_rejects_missing_certificate(self):
        self.current_certificate = ""
        with self.assertRaisesRegex(ValueError, "certificate was not reported"):
            self.verify()

    def test_rejects_wrong_package_version_or_code(self):
        for identity in [("other.app", verifier.VERSION_CODE, verifier.VERSION_NAME), (verifier.PACKAGE, 26, verifier.VERSION_NAME), (verifier.PACKAGE, verifier.VERSION_CODE, "1.1.13")]:
            with self.subTest(identity=identity):
                self.current_identity = identity
                with self.assertRaisesRegex(ValueError, "does not match the release"):
                    self.verify()

    def test_rejects_previous_apk_with_wrong_package_or_nonincreasing_code(self):
        for identity in [("other.app", 26, "1.1.13"), (verifier.PACKAGE, verifier.VERSION_CODE, verifier.VERSION_NAME)]:
            with self.subTest(identity=identity):
                self.previous_identity = identity
                with self.assertRaisesRegex(ValueError, "same package and a lower versionCode"):
                    self.verify()

    def test_propagates_signature_verification_failure(self):
        with patch.object(subprocess, "check_output", side_effect=subprocess.CalledProcessError(1, "apksigner")):
            with self.assertRaises(subprocess.CalledProcessError):
                verifier.verify(Path("new.apk"), Path("previous.apk"), Path("build-tools"))


if __name__ == "__main__":
    unittest.main()
