from __future__ import annotations

import importlib.util
import json
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

    def test_writes_status_artifact_atomically(self) -> None:
        output_path = Path(tempfile.mkdtemp(prefix="lichtfeld-status-artifact-"))
        try:
            target = APP._write_status_file(output_path, {"status": "running", "startedAt": "now"})
            self.assertEqual(target.name, ".web-status.json")
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["status"], "running")
            self.assertEqual(list(output_path.glob("*.tmp")), [])
        finally:
            shutil.rmtree(output_path, ignore_errors=True)

    def test_dispatch_uses_only_allowlisted_dynamic_gpu(self) -> None:
        calls: list[tuple[str, str, list[str]]] = []

        class FakeConfiguredTrainer:
            def __init__(self, gpu: str) -> None:
                self.gpu = gpu

            def spawn(self, *, job_id: str, args: list[str]):
                calls.append((self.gpu, job_id, args))
                return type("Call", (), {"object_id": "fc-test"})()

        class FakeTrainer:
            def with_options(self, *, gpu: str) -> FakeConfiguredTrainer:
                return FakeConfiguredTrainer(gpu)

        original = APP.gpu_trainer
        APP.gpu_trainer = FakeTrainer()
        try:
            result = APP.dispatch_job({"jobId": "job-1", "args": ["--headless"], "gpu": "L40S"})
            self.assertEqual(result["callId"], "fc-test")
            self.assertEqual(calls, [("L40S", "job-1", ["--headless"])])
            with self.assertRaisesRegex(ValueError, "Unsupported Modal GPU"):
                APP.dispatch_job({"jobId": "job-2", "args": ["--headless"], "gpu": "H100:99"})
        finally:
            APP.gpu_trainer = original

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
