from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


APP_PATH = Path(__file__).with_name("app.py")
SPEC = importlib.util.spec_from_file_location("lichtfeld_modal_timelapse_under_test", APP_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {APP_PATH}")
APP = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = APP
SPEC.loader.exec_module(APP)


class ModalTimelapseSyncTests(unittest.TestCase):
    def test_commits_new_frames_before_returning_them_for_publication(self) -> None:
        output_path = Path(tempfile.mkdtemp(prefix="lichtfeld-timelapse-sync-"))
        seen: set[tuple[str, int, str]] = set()
        calls: list[str] = []
        try:
            frame_path = output_path / "timelapse" / "cam-01" / "0001.png"
            frame_path.parent.mkdir(parents=True)
            frame_path.write_bytes(b"frame")

            frames = APP._scan_and_commit_timelapse(output_path, seen, lambda: calls.append("commit"))

            self.assertEqual(calls, ["commit"])
            self.assertEqual([frame.file_path for frame in frames], [str(frame_path)])
        finally:
            shutil.rmtree(output_path, ignore_errors=True)

    def test_retries_frames_after_a_failed_commit(self) -> None:
        output_path = Path(tempfile.mkdtemp(prefix="lichtfeld-timelapse-retry-"))
        seen: set[tuple[str, int, str]] = set()
        try:
            frame_path = output_path / "timelapse" / "cam-01" / "0001.png"
            frame_path.parent.mkdir(parents=True)
            frame_path.write_bytes(b"frame")

            def fail_commit() -> None:
                raise RuntimeError("commit failed")

            with self.assertRaisesRegex(RuntimeError, "commit failed"):
                APP._scan_and_commit_timelapse(output_path, seen, fail_commit)

            retried = APP._scan_and_commit_timelapse(output_path, seen, lambda: None)
            self.assertEqual([frame.file_path for frame in retried], [str(frame_path)])
        finally:
            shutil.rmtree(output_path, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
