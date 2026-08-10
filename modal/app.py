"""Modal deployment for the LichtFeld Studio web application.

The web process and the trainer intentionally run as separate Modal Functions:
the API can scale to zero independently, while a GPU container only exists for
the duration of a training call.  The Node application remains the source of
truth for jobs; this module dispatches work and persists trainer artifacts.
"""

from __future__ import annotations

import codecs
import errno
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterable

import modal


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_NAME = os.getenv("MODAL_APP_NAME", "lichtfeld-studio-web-modal")
DATA_VOLUME_NAME = os.getenv("MODAL_DATA_VOLUME", "lichtfeld-data")
STATE_VOLUME_NAME = os.getenv("MODAL_STATE_VOLUME", "lichtfeld-web-state")
WEB_SECRET_NAME = os.getenv("MODAL_WEB_SECRET_NAME", "lichtfeld-modal-web")

DATA_MOUNT = "/data"
STATE_MOUNT = "/state"
WEB_PORT = 3000
VOLUME_HELPER_PORT = 3001
DEFAULT_TRAINER_TIMEOUT_SECONDS = 86_400
MAX_TRAINER_TIMEOUT_SECONDS = 86_400
DEFAULT_TRAINER_MAX_CONTAINERS = 5
DEFAULT_MODAL_GPU = "A10"
WEB_TRAINING_LOG_NAME = ".web-training.log"
WEB_STATUS_NAME = ".web-status.json"

# Keep this list in lockstep with the backend's public GPU selector.  Values
# are intentionally exact Modal SKU strings; accepting arbitrary user input
# would create unbounded dynamic Function variants and can lead to surprises
# in both capacity and cost.
MODAL_GPU_OPTIONS = (
    "T4",
    "L4",
    "A10",
    "L40S",
    "A100",
    "A100-40GB",
    "A100-80GB",
    "RTX-PRO-6000",
    "H100",
    "H100!",
    "H200",
    "B200",
    "B200+",
    "B300",
)


def _positive_int(name: str, default: int, maximum: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw)
        except ValueError as exc:
            raise ValueError(f"{name} must be an integer") from exc
    if value < 1:
        raise ValueError(f"{name} must be >= 1")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be <= {maximum}")
    return value


def _secret(name: str) -> list[Any]:
    """Return a Modal Secret reference without embedding any secret value."""

    return [modal.Secret.from_name(name)]


def _secrets(*names: str) -> list[Any]:
    return [secret for name in names for secret in _secret(name)]


def _image_from_dockerfile(env_name: str, dockerfile: Path) -> Any:
    registry_ref = os.getenv(env_name, "").strip()
    if registry_ref:
        # A registry image is useful for teams that publish the expensive LFS
        # build once.  It must contain Python and the packages in requirements.
        return modal.Image.from_registry(registry_ref)
    return modal.Image.from_dockerfile(str(dockerfile), context_dir=str(REPO_ROOT))


app = modal.App(APP_NAME)
data_volume = modal.Volume.from_name(DATA_VOLUME_NAME, create_if_missing=True)
state_volume = modal.Volume.from_name(STATE_VOLUME_NAME, create_if_missing=True)

WEB_IMAGE = _image_from_dockerfile("MODAL_WEB_IMAGE", REPO_ROOT / "modal" / "Dockerfile.web")
GPU_IMAGE = _image_from_dockerfile("MODAL_GPU_IMAGE", REPO_ROOT / "modal" / "Dockerfile.gpu")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_DATA_PATH_FLAGS = {
    "--data-path",
    "--output-path",
    "--config",
    "--resume",
    "--init",
    "--import-cameras",
    "--log-file",
    "--python-script",
}


def _arg_values(args: Iterable[str], flag: str) -> list[str]:
    values = list(args)
    result: list[str] = []
    for index, value in enumerate(values):
        if value == flag:
            if index + 1 >= len(values) or not values[index + 1]:
                raise ValueError(f"{flag} requires a path")
            result.append(values[index + 1])
    return result


def _validate_data_paths(args: Iterable[str]) -> None:
    data_root = Path(DATA_MOUNT).resolve()
    values = list(args)
    for index, flag in enumerate(values):
        if flag not in _DATA_PATH_FLAGS:
            continue
        if index + 1 >= len(values):
            raise ValueError(f"{flag} requires a path")
        raw_path = values[index + 1]
        path = Path(raw_path)
        if not path.is_absolute():
            raise ValueError(f"{flag} must use an absolute /data path")
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(data_root)
        except ValueError as exc:
            raise ValueError(f"{flag} path must stay under {DATA_MOUNT}") from exc


def _payload_string(payload: dict[str, Any], key: str, *, maximum: int) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"{key} must be a non-empty string of at most {maximum} characters")
    return value


def _validate_modal_gpu(value: str | None) -> str:
    candidate = (value or os.getenv("MODAL_GPU", DEFAULT_MODAL_GPU)).strip()
    if candidate not in MODAL_GPU_OPTIONS:
        allowed = ", ".join(MODAL_GPU_OPTIONS)
        raise ValueError(f"Unsupported Modal GPU '{candidate}'. Allowed values: {allowed}")
    return candidate


def dispatch_job(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and dispatch one trainer call from the loopback helper.

    This intentionally has no callback URL or bearer token.  The helper only
    binds to 127.0.0.1 inside the web container, and the trainer writes its
    durable state/log artifacts directly to the shared Volume instead of
    waking the web process for every line or timelapse frame.
    """

    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    job_id = _payload_string(payload, "jobId", maximum=256)
    args = payload.get("args")
    if not isinstance(args, list) or not 1 <= len(args) <= 512 or not all(isinstance(arg, str) for arg in args):
        raise ValueError("args must be a non-empty list of at most 512 strings")
    if any("\x00" in arg for arg in args):
        raise ValueError("args must not contain NUL bytes")
    try:
        _validate_data_paths(args)
    except ValueError:
        raise

    raw_gpu = payload.get("gpu")
    if raw_gpu is not None and not isinstance(raw_gpu, str):
        raise ValueError("gpu must be a Modal GPU SKU string")
    gpu = _validate_modal_gpu(raw_gpu)

    try:
        # Dynamic configuration keeps the base Function GPU-neutral and lets
        # each request select one allowlisted SKU without accepting arbitrary
        # user-controlled Modal options.
        call = gpu_trainer.with_options(gpu=gpu).spawn(job_id=job_id, args=args)
    except Exception as exc:  # Modal SDK errors should be surfaced as 502.
        raise RuntimeError(f"Failed to dispatch trainer: {exc}") from exc

    return {"accepted": True, "callId": call.object_id, "jobId": job_id, "gpu": gpu}


def cancel_job(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    call_id = _payload_string(payload, "callId", maximum=256)
    job_id = _payload_string(payload, "jobId", maximum=256)
    try:
        call = modal.FunctionCall.from_id(call_id)
        # Let the trainer's finally block commit the data Volume before Modal
        # tears down an idle container.
        call.cancel(terminate_containers=False)
    except Exception as exc:
        raise LookupError(f"Unable to cancel trainer call: {exc}") from exc
    return {"accepted": True, "callId": call_id, "jobId": job_id}


class _VolumeHandler(BaseHTTPRequestHandler):
    """Loopback-only helper for Volume lifecycle and trainer control.

    The server deliberately binds to 127.0.0.1.  It is not a second Modal
    Function or public control plane; Node talks to it over the same web
    container network namespace at ``http://127.0.0.1:3001``.
    """

    volume: modal.Volume
    volume_lock = threading.Lock()
    max_body_bytes = 2 * 1024 * 1024

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("Content-Length must be an integer") from exc
        if length < 0 or length > self.max_body_bytes:
            raise ValueError("Request body is too large")
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object")
        return payload

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/health":
            self._json(200, {"ok": True})
            return
        self._json(404, {"message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._json(400, {"message": str(exc)})
            return

        if self.path == "/jobs/dispatch":
            try:
                self._json(200, dispatch_job(payload))
            except ValueError as exc:
                self._json(400, {"message": str(exc)})
            except RuntimeError as exc:
                self._json(502, {"message": str(exc)})
            return

        if self.path == "/jobs/cancel":
            try:
                self._json(200, cancel_job(payload))
            except ValueError as exc:
                self._json(400, {"message": str(exc)})
            except LookupError as exc:
                self._json(404, {"message": str(exc)})
            return

        if self.path not in {"/data/commit", "/data/reload"}:
            self._json(404, {"message": "Not found"})
            return

        try:
            with self.volume_lock:
                if self.path == "/data/commit":
                    self.volume.commit()
                else:
                    self.volume.reload()
        except Exception as exc:
            self._json(500, {"message": str(exc)})
            return
        self._json(200, {"ok": True})

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def _start_volume_helper() -> ThreadingHTTPServer:
    handler = type("VolumeHandler", (_VolumeHandler,), {"volume": data_volume})
    server = ThreadingHTTPServer(("127.0.0.1", VOLUME_HELPER_PORT), handler)
    thread = threading.Thread(target=server.serve_forever, name="modal-volume-helper", daemon=True)
    thread.start()
    return server


@app.function(
    image=WEB_IMAGE,
    volumes={DATA_MOUNT: data_volume, STATE_MOUNT: state_volume},
    min_containers=0,
    max_containers=1,
    scaledown_window=300,
    timeout=300,
    secrets=_secret(WEB_SECRET_NAME),
)
@modal.concurrent(max_inputs=100)
@modal.web_server(WEB_PORT)
def web_server() -> None:
    """Run the existing Node API/frontend process behind Modal's web proxy."""

    helper = _start_volume_helper()
    node_env = os.environ.copy()
    # Dispatch/cancel and Volume commit/reload share one loopback helper.  A
    # custom external control URL would bypass that helper and is therefore
    # intentionally ignored.
    modal_control_url = f"http://127.0.0.1:{VOLUME_HELPER_PORT}"
    node_env.update(
        {
            "DATA_ROOT": DATA_MOUNT,
            "DATASETS_DIR": f"{DATA_MOUNT}/datasets",
            "OUTPUTS_DIR": f"{DATA_MOUNT}/outputs",
            "LOGS_DIR": f"{STATE_MOUNT}/logs",
            "DB_PATH": f"{STATE_MOUNT}/db/app.db",
            "MODAL_VOLUME_HELPER_URL": f"http://127.0.0.1:{VOLUME_HELPER_PORT}",
            "PORT": str(WEB_PORT),
            "NODE_ENV": "production",
            "TRAINING_EXECUTOR": "modal",
            "MODAL_CONTROL_URL": modal_control_url,
        }
    )
    node_root = Path(os.getenv("MODAL_NODE_ROOT", "/app"))
    process = subprocess.Popen(
        ["node", "scripts/docker-entrypoint.mjs"],
        cwd=node_root,
        env=node_env,
        stdin=subprocess.DEVNULL,
    )

    def _forward_exit() -> None:
        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError(f"Node backend exited with code {return_code}")

    threading.Thread(target=_forward_exit, name="node-process-wait", daemon=True).start()
    # Keep the helper reachable for the life of the web server.  Modal probes
    # the declared web port independently, so this function can return.
    _ = helper


def _arg_value(args: Iterable[str], flag: str) -> str | None:
    values = _arg_values(args, flag)
    return values[-1] if values else None


def _replace_arg_value(args: Iterable[str], flag: str, replacement: str) -> list[str]:
    """Replace every value for a validated two-token CLI flag."""

    values = list(args)
    replaced = False
    for index, value in enumerate(values):
        if value != flag:
            continue
        if index + 1 >= len(values) or not values[index + 1]:
            raise ValueError(f"{flag} requires a path")
        values[index + 1] = replacement
        replaced = True
    if not replaced:
        raise ValueError(f"{flag} is required")
    return values


@dataclass(frozen=True)
class StagedDataset:
    source_path: Path
    data_path: Path
    scratch_path: Path
    file_count: int
    size_bytes: int
    elapsed_seconds: float


def _stage_dataset_locally(
    source_path: Path,
    progress: Callable[[int, int, float], None] | None = None,
    *,
    dataset_root: Path | None = None,
) -> StagedDataset:
    """Copy one dataset from the shared Volume to the container-local SSD."""

    source_path = source_path.resolve(strict=True)
    allowed_root = (dataset_root or Path(DATA_MOUNT) / "datasets").resolve(strict=False)
    try:
        relative_source = source_path.relative_to(allowed_root)
    except ValueError as exc:
        raise ValueError(f"Dataset path must stay under {allowed_root}") from exc
    if not relative_source.parts:
        raise ValueError(f"Dataset path must identify one dataset below {allowed_root}")
    if not source_path.is_dir():
        raise ValueError(f"Dataset path must be a directory: {source_path}")

    scratch_parent = Path("/tmp/lichtfeld-datasets")
    scratch_parent.mkdir(parents=True, exist_ok=True)
    scratch_path = Path(tempfile.mkdtemp(prefix="job-", dir=scratch_parent))
    data_path = scratch_path / "dataset"
    started_at = time.monotonic()
    last_progress_at = started_at
    file_count = 0
    size_bytes = 0
    progress_lock = threading.Lock()

    def copy_file(source: str, destination: str) -> str:
        nonlocal file_count, size_bytes, last_progress_at
        try:
            copied = shutil.copyfile(source, destination)
        except OSError as exc:
            if exc.errno == errno.ENOSPC:
                raise RuntimeError(
                    "Container-local disk is too small to stage the dataset; "
                    "increase gpu_trainer ephemeral_disk"
                ) from exc
            raise
        try:
            copied_size = Path(destination).stat().st_size
        except OSError:
            copied_size = 0
        progress_snapshot: tuple[int, int, float] | None = None
        with progress_lock:
            file_count += 1
            size_bytes += copied_size
            now = time.monotonic()
            if progress is not None and now - last_progress_at >= 10:
                progress_snapshot = (file_count, size_bytes, now - started_at)
                last_progress_at = now
        if progress is not None and progress_snapshot is not None:
            progress(*progress_snapshot)
        return copied

    try:
        copy_jobs: list[tuple[str, str]] = []
        for current_root, directory_names, file_names in os.walk(source_path, followlinks=False):
            current_path = Path(current_root)
            relative_path = current_path.relative_to(source_path)
            destination_dir = data_path / relative_path
            destination_dir.mkdir(parents=True, exist_ok=True)

            for directory_name in list(directory_names):
                source_dir = current_path / directory_name
                destination = destination_dir / directory_name
                if source_dir.is_symlink():
                    raise ValueError(f"Dataset staging does not support symlinks: {source_dir}")
                destination.mkdir(exist_ok=True)

            for file_name in file_names:
                source_file = current_path / file_name
                destination = destination_dir / file_name
                if source_file.is_symlink():
                    raise ValueError(f"Dataset staging does not support symlinks: {source_file}")
                elif source_file.is_file():
                    copy_jobs.append((str(source_file), str(destination)))
                else:
                    raise ValueError(f"Dataset contains an unsupported file type: {source_file}")

        workers = _positive_int("MODAL_STAGING_WORKERS", 32, maximum=64)
        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="dataset-stage")
        futures = []
        try:
            futures = [executor.submit(copy_file, source, destination) for source, destination in copy_jobs]
            for future in as_completed(futures):
                future.result()
        except BaseException:
            for future in futures:
                future.cancel()
            executor.shutdown(wait=True, cancel_futures=True)
            raise
        else:
            executor.shutdown(wait=True)
    except OSError as exc:
        shutil.rmtree(scratch_path, ignore_errors=True)
        if exc.errno == errno.ENOSPC:
            raise RuntimeError(
                "Container-local disk is too small to stage the dataset; "
                "increase gpu_trainer ephemeral_disk"
            ) from exc
        raise
    except BaseException:
        # Modal cancellation may interrupt Python with KeyboardInterrupt while
        # copytree is still running, before gpu_trainer receives the result.
        shutil.rmtree(scratch_path, ignore_errors=True)
        raise

    return StagedDataset(
        source_path=source_path,
        data_path=data_path,
        scratch_path=scratch_path,
        file_count=file_count,
        size_bytes=size_bytes,
        elapsed_seconds=time.monotonic() - started_at,
    )


def _format_bytes(value: int) -> str:
    amount = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if amount < 1024 or unit == "TiB":
            return f"{amount:.1f} {unit}"
        amount /= 1024
    return f"{amount:.1f} TiB"


def _training_log_path(output_path: Path) -> Path:
    return output_path / WEB_TRAINING_LOG_NAME


def _status_path(output_path: Path) -> Path:
    return output_path / WEB_STATUS_NAME


def _write_status_file(output_path: Path, payload: dict[str, Any]) -> Path:
    """Atomically publish the current job state inside the shared Volume."""

    output_path.mkdir(parents=True, exist_ok=True)
    target = _status_path(output_path)
    temporary = output_path / f".{WEB_STATUS_NAME}.{os.getpid()}.{threading.get_ident()}.tmp"
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    temporary.write_text(encoded, encoding="utf-8")
    os.replace(temporary, target)
    return target


def _append_training_log(log_file: Any, line: str) -> None:
    """Write one decoded process record as UTF-8 and flush it promptly."""

    log_file.write(line)
    log_file.write("\n")
    log_file.flush()


_FRAME_RE = re.compile(r"(?P<iteration>\d+)\.(?:jpg|jpeg|png)$", re.IGNORECASE)
_FRAME_SUFFIXES = {".jpg", ".jpeg", ".png"}
_SPLAT_SOURCE_SUFFIXES = {".ply", ".resume", ".sog", ".spz"}
_SPLAT_EXPORT_FORMATS = ("html", "sog", "spz", "ply")


@dataclass(frozen=True)
class TimelapseFrame:
    camera_name: str
    iteration: int
    file_path: str
    size_bytes: int
    created_at: str


def _scan_timelapse(output_path: Path, seen: set[tuple[str, int, str]]) -> list[TimelapseFrame]:
    root = output_path / "timelapse"
    if not root.is_dir():
        return []
    frames: list[TimelapseFrame] = []
    try:
        paths = root.rglob("*")
    except OSError:
        return []
    for path in paths:
        if not path.is_file() or path.suffix.lower() not in _FRAME_SUFFIXES:
            continue
        match = _FRAME_RE.search(path.name)
        if match is None:
            continue
        relative = path.relative_to(root)
        camera_name = relative.parent.as_posix()
        if camera_name in {"", "."}:
            camera_name = "default"
        iteration = int(match.group("iteration"))
        key = (camera_name, iteration, str(path))
        if key in seen:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        seen.add(key)
        frames.append(
            TimelapseFrame(
                camera_name=camera_name,
                iteration=iteration,
                file_path=str(path),
                size_bytes=stat.st_size,
                created_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
            )
        )
    return sorted(frames, key=lambda item: (item.camera_name, item.iteration, item.file_path))


def _scan_and_commit_timelapse(
    output_path: Path,
    seen: set[tuple[str, int, str]],
    commit: Callable[[], None],
) -> list[TimelapseFrame]:
    """Persist newly discovered frames before exposing their paths to the API."""

    frames = _scan_timelapse(output_path, seen)
    if not frames:
        return []

    try:
        commit()
    except BaseException:
        # A failed commit must not permanently suppress these frames. Let the
        # next scan retry both persistence and publication.
        for frame in frames:
            seen.discard((frame.camera_name, frame.iteration, frame.file_path))
        raise
    return frames


def _find_latest_splat_source(output_path: Path) -> Path | None:
    latest: tuple[float, Path] | None = None
    if not output_path.is_dir():
        return None
    try:
        candidates = output_path.rglob("*")
        for candidate in candidates:
            if not candidate.is_file() or candidate.suffix.lower() not in _SPLAT_SOURCE_SUFFIXES:
                continue
            if any(part in {".web-preview", "modal-exports", "timelapse"} for part in candidate.parts):
                continue
            try:
                mtime = candidate.stat().st_mtime
            except OSError:
                continue
            if latest is None or mtime > latest[0]:
                latest = (mtime, candidate)
    except OSError:
        return None
    return latest[1] if latest else None


def _prepare_splat_exports(binary: str, output_path: Path) -> tuple[list[str], list[str]]:
    """Best-effort exports for the CPU-only web image.

    Node's normal lazy converter needs the LFS binary, which is deliberately
    absent from Dockerfile.web.  Keeping stable exact-format artifacts under
    ``modal-exports`` lets the API serve previews/downloads without launching
    a second conversion in the CPU container.
    """

    source = _find_latest_splat_source(output_path)
    if source is None:
        return [], []
    export_dir = output_path / "modal-exports"
    try:
        export_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return [f"export directory unavailable: {exc}"], []
    warnings: list[str] = []
    logs: list[str] = []
    timeout = _positive_int("MODAL_PREVIEW_TIMEOUT", 3_600, maximum=MAX_TRAINER_TIMEOUT_SECONDS)
    for format_name in _SPLAT_EXPORT_FORMATS:
        target = export_dir / f"model.{format_name}"
        try:
            if target.is_file() and target.stat().st_mtime >= source.stat().st_mtime:
                continue
        except OSError:
            pass
        try:
            result = subprocess.run(
                [binary, "convert", str(source), str(target), "--format", format_name, "--overwrite"],
                cwd=DATA_MOUNT,
                env={**os.environ, "LOG_LEVEL": os.getenv("LOG_LEVEL", "info")},
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except Exception as exc:
            warnings.append(f"{format_name} export failed: {exc}")
            continue
        for stream_name, value in (("stdout", result.stdout), ("stderr", result.stderr)):
            lines = [line for line in value.splitlines() if line]
            logs.extend(f"preview {format_name} {stream_name}: {line}" for line in lines)
        if result.returncode != 0:
            warnings.append(f"{format_name} export exited with code {result.returncode}")
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
    return warnings, logs


class _StreamDone:
    def __init__(self, stream_name: str) -> None:
        self.stream_name = stream_name


def _iter_records(chunks: Iterable[str]) -> Iterable[str]:
    """Split decoded chunks on CR/LF, including delimiters at chunk edges.

    A carriage return is emitted immediately so progress indicators are
    retained in the durable training log while the process is still running.
    If the next chunk starts with a line feed, it is consumed as the second
    half of CRLF rather than producing an extra empty record.
    """

    record_parts: list[str] = []
    pending_cr = False
    for chunk in chunks:
        if not chunk:
            continue

        offset = 0
        while offset < len(chunk):
            if pending_cr:
                if chunk[offset] == "\n":
                    offset += 1
                pending_cr = False
                if offset >= len(chunk):
                    break

            carriage_return = chunk.find("\r", offset)
            line_feed = chunk.find("\n", offset)
            delimiters = [position for position in (carriage_return, line_feed) if position >= 0]
            if not delimiters:
                record_parts.append(chunk[offset:])
                break

            delimiter_index = min(delimiters)
            record_parts.append(chunk[offset:delimiter_index])
            delimiter = chunk[delimiter_index]
            offset = delimiter_index + 1
            if delimiter == "\r":
                pending_cr = True
            yield "".join(record_parts)
            record_parts.clear()

    if record_parts:
        yield "".join(record_parts)


def _reader(stream_name: str, stream: Any, events: queue.Queue[tuple[str, str] | _StreamDone]) -> None:
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    output = sys.stdout if stream_name == "stdout" else sys.stderr

    def decoded_chunks(file_descriptor: int) -> Iterable[str]:
        while True:
            chunk = os.read(file_descriptor, 64 * 1024)
            if not chunk:
                break
            decoded = decoder.decode(chunk, final=False)
            if decoded:
                yield decoded
        decoded = decoder.decode(b"", final=True)
        if decoded:
            yield decoded

    try:
        for record in _iter_records(decoded_chunks(stream.fileno())):
            if record:
                try:
                    # Modal's log collector commonly groups output by newline.
                    # Normalize every parsed record to one line so CR-only
                    # progress updates remain visible while preserving ANSI
                    # escape content.
                    output.write(record + "\n")
                    output.flush()
                except (OSError, ValueError):
                    # A closed/invalid container log stream must not prevent
                    # the durable log writer from receiving the record.
                    pass
            events.put((stream_name, record))
    finally:
        events.put(_StreamDone(stream_name))


def _terminate_process(process: subprocess.Popen[bytes], reason: str) -> None:
    print(f"Stopping LichtFeld process: {reason}", flush=True)
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


@app.function(
    image=GPU_IMAGE,
    volumes={DATA_MOUNT: data_volume},
    min_containers=0,
    # Volume v1 supports distinct concurrent writers, but Modal recommends no
    # more than five at once. Keep that safe default while allowing operators
    # to tune the cost/concurrency trade-off for their workspace.
    max_containers=_positive_int(
        "MODAL_TRAINER_MAX_CONTAINERS",
        DEFAULT_TRAINER_MAX_CONTAINERS,
    ),
    scaledown_window=2,
    timeout=_positive_int("MODAL_TRAINER_TIMEOUT", DEFAULT_TRAINER_TIMEOUT_SECONDS, MAX_TRAINER_TIMEOUT_SECONDS),
)
def gpu_trainer(job_id: str, args: list[str]) -> dict[str, Any]:
    """Execute one training process and persist durable per-job artifacts.

    The web process is intentionally not called for progress updates.  Every
    decoded stdout/stderr record is appended to ``.web-training.log`` and the
    current lifecycle state is atomically replaced in ``.web-status.json``.
    The final Volume commit makes both files visible to the API, which can
    reload and read them on demand.
    """

    if not job_id or not isinstance(job_id, str):
        raise ValueError("job_id is required")
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        raise ValueError("args must be a list of strings")
    _validate_data_paths(args)
    binary = os.getenv("LFS_BIN_PATH", "/opt/lichtfeld/bin/LichtFeld-Studio")
    output_arg = _arg_value(args, "--output-path")
    output_path = Path(output_arg or f"{DATA_MOUNT}/outputs/job-{job_id}")
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path

    stop_reason: str | None = None
    process: subprocess.Popen[bytes] | None = None
    exit_code: int | None = None
    status = "failed"
    error_message: str | None = None
    preview_warnings: list[str] = []
    volume_loaded = False
    staged_dataset: StagedDataset | None = None
    event_queue: queue.Queue[tuple[str, str] | _StreamDone] = queue.Queue()
    done_streams: set[str] = set()
    training_log: Any | None = None
    started_at = _utc_now()

    try:
        # A warm container may be reused for a later call; reload here so a
        # dispatch commit made by the web container is always visible.
        data_volume.reload()
        volume_loaded = True
        output_path.mkdir(parents=True, exist_ok=True)
        training_log = _training_log_path(output_path).open("a", encoding="utf-8")
        _write_status_file(
            output_path,
            {
                "status": "running",
                "startedAt": started_at,
                "finishedAt": None,
                "exitCode": None,
                "errorMessage": None,
                "stopReason": None,
            },
        )

        data_arg = _arg_value(args, "--data-path")
        process_args = list(args)
        if data_arg is not None:
            staging_started_line = f"Staging dataset from {data_arg} to container-local SSD..."
            print(staging_started_line, flush=True)
            assert training_log is not None
            _append_training_log(training_log, staging_started_line)

            def report_staging_progress(file_count: int, size_bytes: int, elapsed_seconds: float) -> None:
                progress_line = (
                    f"Dataset staging: {file_count} files, {_format_bytes(size_bytes)} "
                    f"copied in {elapsed_seconds:.0f}s"
                )
                print(progress_line, flush=True)
                if training_log is not None:
                    _append_training_log(training_log, progress_line)

            staged_dataset = _stage_dataset_locally(Path(data_arg), report_staging_progress)
            process_args = _replace_arg_value(args, "--data-path", str(staged_dataset.data_path))
            staging_completed_line = (
                f"Dataset staged locally: {staged_dataset.file_count} files, "
                f"{_format_bytes(staged_dataset.size_bytes)} in "
                f"{staged_dataset.elapsed_seconds:.1f}s"
            )
            print(staging_completed_line, flush=True)
            assert training_log is not None
            _append_training_log(training_log, staging_completed_line)

        process = subprocess.Popen(
            [binary, *process_args],
            cwd=DATA_MOUNT,
            env={**os.environ, "LOG_LEVEL": os.getenv("LOG_LEVEL", "info")},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert process.stdout is not None and process.stderr is not None
        for stream_name, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
            threading.Thread(
                target=_reader,
                args=(stream_name, stream, event_queue),
                name=f"lfs-{stream_name}",
                daemon=True,
            ).start()

        while done_streams != {"stdout", "stderr"} or process.poll() is None:
            try:
                event = event_queue.get(timeout=0.25)
            except queue.Empty:
                event = None

            if isinstance(event, _StreamDone):
                done_streams.add(event.stream_name)
            elif event is not None:
                _stream_name, line = event
                if training_log is not None:
                    _append_training_log(training_log, line)

        process.wait()
        exit_code = process.returncode

        if stop_reason == "stopped_low_disk":
            status = "stopped_low_disk"
        elif exit_code == 0:
            status = "completed"
        elif exit_code is not None and exit_code < 0:
            status = "stopped"
            stop_reason = stop_reason or f"signal_{-exit_code}"
        else:
            status = "failed"
            error_message = f"Process exited with code {exit_code}"

        if status == "completed":
            preview_warnings, preview_logs = _prepare_splat_exports(binary, output_path)
            if training_log is not None:
                for line in preview_logs:
                    _append_training_log(training_log, line)
                for warning in preview_warnings:
                    _append_training_log(training_log, f"preview warning: {warning}")
    except KeyboardInterrupt:
        stop_reason = stop_reason or "cancelled"
        status = "stopped"
        error_message = "Trainer call was cancelled"
        if process is not None:
            _terminate_process(process, stop_reason)
    except Exception as exc:
        status = "failed"
        error_message = str(exc)
        if training_log is not None:
            _append_training_log(training_log, f"[trainer-error] {error_message}")
        if process is not None:
            _terminate_process(process, "runner_error")
    finally:
        if staged_dataset is not None:
            try:
                shutil.rmtree(staged_dataset.scratch_path)
            except OSError as exc:
                cleanup_warning = f"local dataset cleanup failed: {exc}"
                if training_log is not None:
                    _append_training_log(training_log, f"[cleanup-warning] {cleanup_warning}")
                print(cleanup_warning, flush=True)

        if training_log is not None:
            training_log.close()
            training_log = None

        finished_at = _utc_now()
        terminal_data: dict[str, Any] = {
            "status": status,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "exitCode": exit_code,
            "errorMessage": error_message,
            "stopReason": stop_reason,
        }
        try:
            _write_status_file(output_path, terminal_data)
        except Exception as exc:
            status = "failed"
            error_message = f"status file write failed: {exc}"
            terminal_data.update({"status": status, "errorMessage": error_message})

        # The shared Volume must be committed after all output files are closed
        # so a subsequent reload never observes an open Volume file.
        commit_error: Exception | None = None
        if volume_loaded:
            try:
                data_volume.commit()
            except Exception as exc:
                commit_error = exc

        if commit_error is not None:
            status = "failed"
            error_message = f"data Volume commit failed: {commit_error}"
            terminal_data.update({"status": status, "errorMessage": error_message})
            try:
                _write_status_file(output_path, terminal_data)
                if volume_loaded:
                    # A retry makes the failure itself durable when the first
                    # commit failed transiently (for example, contention).
                    data_volume.commit()
            except Exception as retry_error:
                print(f"{error_message}; retry failed: {retry_error}", flush=True)

    return {
        "jobId": job_id,
        "status": status,
        "exitCode": exit_code,
        "errorMessage": error_message,
        "stopReason": stop_reason,
        "logPath": str(_training_log_path(output_path)),
        "statusPath": str(_status_path(output_path)),
    }
