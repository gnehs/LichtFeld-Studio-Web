"""Modal deployment for the LichtFeld Studio web application.

The web process and the trainer intentionally run as separate Modal Functions:
the API can scale to zero independently, while a GPU container only exists for
the duration of a training call.  The Node application remains the source of
truth for jobs; this module only dispatches work and forwards worker events.
"""

from __future__ import annotations

import codecs
import errno
import hashlib
import hmac
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
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

import modal
from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from pydantic import BaseModel, Field


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_NAME = os.getenv("MODAL_APP_NAME", "lichtfeld-studio-web-modal")
DATA_VOLUME_NAME = os.getenv("MODAL_DATA_VOLUME", "lichtfeld-data")
STATE_VOLUME_NAME = os.getenv("MODAL_STATE_VOLUME", "lichtfeld-web-state")
WEB_SECRET_NAME = os.getenv("MODAL_WEB_SECRET_NAME", "lichtfeld-modal-web")
CONTROL_SECRET_NAME = os.getenv("MODAL_CONTROL_SECRET_NAME", "lichtfeld-modal-control")
CALLBACK_SECRET_NAME = os.getenv("MODAL_CALLBACK_SECRET_NAME", "lichtfeld-modal-callback")

DATA_MOUNT = "/data"
STATE_MOUNT = "/state"
WEB_PORT = 3000
VOLUME_HELPER_PORT = 3001
DEFAULT_TRAINER_TIMEOUT_SECONDS = 86_400
MAX_TRAINER_TIMEOUT_SECONDS = 86_400
DEFAULT_TRAINER_MAX_CONTAINERS = 5


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


def _control_image() -> Any:
    registry_ref = os.getenv("MODAL_CONTROL_IMAGE", "").strip()
    if registry_ref:
        return modal.Image.from_registry(registry_ref)
    return (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install("fastapi>=0.115,<1", "pydantic>=2.9,<3")
    )


app = modal.App(APP_NAME)
data_volume = modal.Volume.from_name(DATA_VOLUME_NAME, create_if_missing=True)
state_volume = modal.Volume.from_name(STATE_VOLUME_NAME, create_if_missing=True)

WEB_IMAGE = _image_from_dockerfile("MODAL_WEB_IMAGE", REPO_ROOT / "modal" / "Dockerfile.web")
GPU_IMAGE = _image_from_dockerfile("MODAL_GPU_IMAGE", REPO_ROOT / "modal" / "Dockerfile.gpu")
CONTROL_IMAGE = _control_image()


def _bearer_matches(request: FastAPIRequest, env_name: str) -> bool:
    expected = os.getenv(env_name, "")
    provided = request.headers.get("authorization", "")
    if not expected or not provided.lower().startswith("bearer "):
        return False
    actual = provided[7:].strip()
    # Compare fixed-length digests to avoid leaking token length through the
    # comparison operation.  The token itself is supplied by a Modal Secret.
    return hmac.compare_digest(
        hashlib.sha256(actual.encode("utf-8")).digest(),
        hashlib.sha256(expected.encode("utf-8")).digest(),
    )


def _require_bearer(request: FastAPIRequest, env_name: str) -> None:
    if not _bearer_matches(request, env_name):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _validate_callback_base_url(value: str) -> str:
    callback = value.strip().rstrip("/")
    parsed = urlsplit(callback)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("callbackBaseUrl must be an absolute http(s) URL")
    if parsed.query or parsed.fragment:
        raise ValueError("callbackBaseUrl must not contain a query or fragment")
    return callback


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


class DispatchRequest(BaseModel):
    jobId: str = Field(min_length=1, max_length=256)
    args: list[str] = Field(min_length=1, max_length=512)
    callbackBaseUrl: str = Field(min_length=1, max_length=2048)


class CancelRequest(BaseModel):
    callId: str = Field(min_length=1, max_length=256)
    jobId: str = Field(min_length=1, max_length=256)


control_api = FastAPI(title="LichtFeld Modal control plane")


@control_api.get("/health")
async def control_health() -> dict[str, bool]:
    return {"ok": True}


@control_api.post("/jobs/dispatch")
async def dispatch_job(payload: DispatchRequest, request: FastAPIRequest) -> dict[str, Any]:
    _require_bearer(request, "MODAL_CONTROL_TOKEN")
    try:
        callback_base_url = _validate_callback_base_url(payload.callbackBaseUrl)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if any("\x00" in arg for arg in payload.args):
        raise HTTPException(status_code=400, detail="args must not contain NUL bytes")
    try:
        _validate_data_paths(payload.args)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        call = gpu_trainer.spawn(
            job_id=payload.jobId,
            args=payload.args,
            callback_base_url=callback_base_url,
        )
    except Exception as exc:  # Modal SDK errors should be surfaced as 502.
        raise HTTPException(status_code=502, detail=f"Failed to dispatch trainer: {exc}") from exc

    return {"accepted": True, "callId": call.object_id, "jobId": payload.jobId}


@control_api.post("/jobs/cancel")
async def cancel_job(payload: CancelRequest, request: FastAPIRequest) -> dict[str, Any]:
    _require_bearer(request, "MODAL_CONTROL_TOKEN")
    try:
        call = modal.FunctionCall.from_id(payload.callId)
        # Let the trainer's finally block commit the data Volume and report a
        # terminal status before Modal tears down an idle container.
        call.cancel(terminate_containers=False)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Unable to cancel trainer call: {exc}") from exc
    return {"accepted": True, "callId": payload.callId, "jobId": payload.jobId}


class _VolumeHandler(BaseHTTPRequestHandler):
    """Loopback-only helper used by Node to commit/reload the shared Volume."""

    volume: modal.Volume
    volume_lock = threading.Lock()

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        try:
            with self.volume_lock:
                if self.path == "/data/commit":
                    self.volume.commit()
                elif self.path == "/data/reload":
                    self.volume.reload()
                else:
                    self._json(404, {"message": "Not found"})
                    return
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
    scaledown_window=2,
    timeout=300,
    secrets=_secrets(WEB_SECRET_NAME, CONTROL_SECRET_NAME, CALLBACK_SECRET_NAME),
)
@modal.concurrent(max_inputs=100)
@modal.web_server(WEB_PORT)
def web_server() -> None:
    """Run the existing Node API/frontend process behind Modal's web proxy."""

    helper = _start_volume_helper()
    node_env = os.environ.copy()
    public_base_url = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    modal_control_url = os.getenv("MODAL_CONTROL_URL", "").strip().rstrip("/")
    if not public_base_url:
        web_url = web_server.get_web_url()
        if not web_url:
            raise RuntimeError("Modal did not provide the web_server URL")
        public_base_url = web_url.rstrip("/")
    if not modal_control_url:
        control_url = control_server.get_web_url()
        if not control_url:
            raise RuntimeError("Modal did not provide the control_server URL")
        modal_control_url = control_url.rstrip("/")
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
            "PUBLIC_BASE_URL": public_base_url,
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


@app.function(
    image=CONTROL_IMAGE,
    min_containers=0,
    max_containers=1,
    scaledown_window=2,
    timeout=300,
    secrets=_secret(CONTROL_SECRET_NAME),
)
@modal.concurrent(max_inputs=32)
@modal.asgi_app()
def control_server() -> FastAPI:
    return control_api


def _callback_url(callback_base_url: str, job_id: str) -> str:
    return f"{callback_base_url.rstrip('/')}/api/internal/modal/jobs/{quote(job_id, safe='')}"


def _post_callback(callback_base_url: str, job_id: str, event_type: str, data: dict[str, Any]) -> None:
    payload = {
        "type": event_type,
        "ts": _utc_now(),
        "data": data,
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        _callback_url(callback_base_url, job_id) + "/events",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.getenv('MODAL_CALLBACK_TOKEN', '')}",
            "Content-Type": "application/json",
            "User-Agent": "lichtfeld-modal-trainer/1",
        },
    )
    attempts = _positive_int("MODAL_CALLBACK_ATTEMPTS", 3, maximum=8)
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=10) as response:
                if response.status < 200 or response.status >= 300:
                    raise RuntimeError(f"callback returned HTTP {response.status}")
            return
        except (HTTPError, URLError, TimeoutError, OSError, RuntimeError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(min(2**attempt, 8))
    if last_error is not None:
        raise last_error


def _safe_callback(
    callback_base_url: str,
    job_id: str,
    event_type: str,
    data: dict[str, Any],
    errors: list[str],
) -> None:
    try:
        _post_callback(callback_base_url, job_id, event_type, data)
    except Exception as exc:
        message = f"{event_type} callback failed: {exc}"
        errors.append(message)
        print(message, flush=True)


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

    A carriage return is emitted immediately so progress indicators can reach
    the callback while the process is still running.  If the next chunk starts
    with a line feed, it is consumed as the second half of CRLF rather than
    producing an empty callback record.
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
            if not record:
                continue
            try:
                # Modal's log collector commonly groups output by newline.
                # Normalize every parsed record to one line so CR-only progress
                # updates remain visible while preserving ANSI escape content.
                output.write(record + "\n")
                output.flush()
            except (OSError, ValueError):
                # A closed/invalid container log stream must not prevent the
                # callback reader from forwarding the subprocess output.
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
    gpu=os.getenv("MODAL_GPU", "A10"),
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
    secrets=_secret(CALLBACK_SECRET_NAME),
)
def gpu_trainer(job_id: str, args: list[str], callback_base_url: str) -> dict[str, Any]:
    """Execute one LichtFeld training process and stream durable job events."""

    if not job_id or not isinstance(job_id, str):
        raise ValueError("job_id is required")
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        raise ValueError("args must be a list of strings")
    _validate_data_paths(args)
    callback_base_url = _validate_callback_base_url(callback_base_url)
    binary = os.getenv("LFS_BIN_PATH", "/opt/lichtfeld/bin/LichtFeld-Studio")
    output_arg = _arg_value(args, "--output-path")
    output_path = Path(output_arg or f"{DATA_MOUNT}/outputs/job-{job_id}")
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path

    callback_errors: list[str] = []
    seen_frames: set[tuple[str, int, str]] = set()
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
    batches: dict[str, list[str]] = {"stdout": [], "stderr": []}
    last_flush = time.monotonic()
    last_scan = time.monotonic()
    batch_limit = _positive_int("MODAL_LOG_BATCH_LINES", 20, maximum=500)
    scan_interval = max(0.5, float(os.getenv("MODAL_TIMELAPSE_SCAN_SECONDS", "2")))

    def flush_logs() -> None:
        for stream_name, lines in batches.items():
            if not lines:
                continue
            _safe_callback(
                callback_base_url,
                job_id,
                "log",
                {"stream": stream_name, "lines": list(lines)},
                callback_errors,
            )
            lines.clear()

    def scan_frames() -> None:
        nonlocal last_scan
        now = time.monotonic()
        if now - last_scan < scan_interval:
            return
        last_scan = now
        try:
            frames = _scan_and_commit_timelapse(output_path, seen_frames, data_volume.commit)
        except Exception as exc:
            message = f"timelapse Volume commit failed: {exc}"
            callback_errors.append(message)
            print(message, flush=True)
            return
        for frame in frames:
            _safe_callback(
                callback_base_url,
                job_id,
                "timelapse.frame.created",
                {
                    "cameraName": frame.camera_name,
                    "iteration": frame.iteration,
                    "filePath": frame.file_path,
                    "sizeBytes": frame.size_bytes,
                    "createdAt": frame.created_at,
                },
                callback_errors,
            )
        _safe_callback(
            callback_base_url,
            job_id,
            "timelapse.scan.completed",
            {"scanned": len(seen_frames), "created": len(frames)},
            callback_errors,
        )

    _safe_callback(
        callback_base_url,
        job_id,
        "job.status",
        {"status": "running", "startedAt": _utc_now()},
        callback_errors,
    )

    try:
        # A warm container may be reused for a later call; reload here so a
        # dispatch commit made by the web container is always visible.
        data_volume.reload()
        volume_loaded = True

        data_arg = _arg_value(args, "--data-path")
        process_args = list(args)
        if data_arg is not None:
            staging_started_line = f"Staging dataset from {data_arg} to container-local SSD..."
            print(staging_started_line, flush=True)
            _safe_callback(
                callback_base_url,
                job_id,
                "log",
                {"stream": "stdout", "lines": [staging_started_line]},
                callback_errors,
            )

            def report_staging_progress(file_count: int, size_bytes: int, elapsed_seconds: float) -> None:
                progress_line = (
                    f"Dataset staging: {file_count} files, {_format_bytes(size_bytes)} "
                    f"copied in {elapsed_seconds:.0f}s"
                )
                print(progress_line, flush=True)
                _safe_callback(
                    callback_base_url,
                    job_id,
                    "log",
                    {"stream": "stdout", "lines": [progress_line]},
                    callback_errors,
                )

            staged_dataset = _stage_dataset_locally(Path(data_arg), report_staging_progress)
            process_args = _replace_arg_value(args, "--data-path", str(staged_dataset.data_path))
            staging_completed_line = (
                f"Dataset staged locally: {staged_dataset.file_count} files, "
                f"{_format_bytes(staged_dataset.size_bytes)} in "
                f"{staged_dataset.elapsed_seconds:.1f}s"
            )
            print(staging_completed_line, flush=True)
            _safe_callback(
                callback_base_url,
                job_id,
                "log",
                {"stream": "stdout", "lines": [staging_completed_line]},
                callback_errors,
            )

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
                stream_name, line = event
                batches[stream_name].append(line)
                if len(batches[stream_name]) >= batch_limit:
                    flush_logs()

            if time.monotonic() - last_flush >= 1:
                flush_logs()
                last_flush = time.monotonic()
            scan_frames()

        process.wait()
        exit_code = process.returncode
        flush_logs()
        scan_frames()

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
            if preview_logs:
                _safe_callback(
                    callback_base_url,
                    job_id,
                    "log",
                    {"stream": "stdout", "lines": preview_logs},
                    callback_errors,
                )
    except KeyboardInterrupt:
        stop_reason = stop_reason or "cancelled"
        status = "stopped"
        error_message = "Trainer call was cancelled"
        if process is not None:
            _terminate_process(process, stop_reason)
    except Exception as exc:
        status = "failed"
        error_message = str(exc)
        if process is not None:
            _terminate_process(process, "runner_error")
    finally:
        if staged_dataset is not None:
            try:
                shutil.rmtree(staged_dataset.scratch_path)
            except OSError as exc:
                cleanup_warning = f"local dataset cleanup failed: {exc}"
                callback_errors.append(cleanup_warning)
                print(cleanup_warning, flush=True)

        # The shared Volume must be committed before the API receives a
        # terminal event; the API reloads it when processing that event.
        if volume_loaded:
            try:
                data_volume.commit()
            except Exception as exc:
                callback_errors.append(f"data Volume commit failed: {exc}")
                if status == "completed":
                    status = "failed"
                    error_message = f"data Volume commit failed: {exc}"

        terminal_data: dict[str, Any] = {
            "status": status,
            "exitCode": exit_code,
            "errorMessage": error_message,
            "stopReason": stop_reason,
        }
        if preview_warnings:
            terminal_data["previewWarnings"] = preview_warnings
        if callback_errors:
            terminal_data["callbackErrors"] = callback_errors[-10:]
        _safe_callback(callback_base_url, job_id, "job.status", terminal_data, callback_errors)

    return {
        "jobId": job_id,
        "status": status,
        "exitCode": exit_code,
        "errorMessage": error_message,
        "stopReason": stop_reason,
    }
