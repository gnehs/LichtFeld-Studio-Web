import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Pause, Play, RefreshCw, SkipBack, SkipForward } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Notice } from "@/lib/app-types";
import type { JobStatus, TimelapseFrame, TrainingJob } from "@/lib/types";
import { computeProgress, sortFramesAscending } from "@/pages/job-detail-utils";

function statusBadgeVariant(status: JobStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "stopped_low_disk") return "destructive";
  if (status === "running") return "default";
  if (status === "queued") return "secondary";
  return "outline";
}

function statusText(status: JobStatus): string {
  if (status === "queued") return "排隊中";
  if (status === "running") return "執行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失敗";
  if (status === "stopped") return "已停止";
  return "低磁碟空間中止";
}

function parseJobParams(job: TrainingJob | null): Record<string, unknown> {
  if (!job?.paramsJson) return {};
  try {
    const parsed = JSON.parse(job.paramsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.trim().length > 0 ? value : "(空字串)";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function JobDetailPage({ onNotice }: { onNotice: (next: Notice) => void }) {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<TrainingJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logConnected, setLogConnected] = useState(false);
  const [latestIteration, setLatestIteration] = useState<number | null>(null);
  const [cameras, setCameras] = useState<Array<{ cameraName: string; frameCount: number; lastIteration: number }>>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [frames, setFrames] = useState<TimelapseFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [playbackMs, setPlaybackMs] = useState(500);

  const params = useMemo(() => parseJobParams(job), [job]);
  const entries = useMemo(() => Object.entries(params).sort(([a], [b]) => a.localeCompare(b)), [params]);
  const selectedFrame = frames[frameIndex] ?? null;
  const progress = useMemo(() => computeProgress(job, latestIteration), [job, latestIteration]);
  const progressPercent = progress.ratio === null ? 0 : Math.round(progress.ratio * 1000) / 10;

  const reloadTimelapseOverview = useCallback(async () => {
    if (!id) return;
    try {
      const [camerasRes, latestRes] = await Promise.all([api.getTimelapseCameras(id), api.getTimelapseLatest(id)]);
      setCameras(camerasRes.items);

      const maxIteration = latestRes.items.reduce<number | null>((acc, item) => {
        if (acc === null || item.iteration > acc) return item.iteration;
        return acc;
      }, null);
      setLatestIteration(maxIteration);

      setSelectedCamera((prev) => {
        if (prev && camerasRes.items.some((item) => item.cameraName === prev)) {
          return prev;
        }
        return camerasRes.items[0]?.cameraName ?? "";
      });
    } catch (error) {
      onNotice({ tone: "error", text: `讀取 Timelapse 失敗：${(error as Error).message}` });
    }
  }, [id, onNotice]);

  const reloadSelectedCameraFrames = useCallback(
    async (stickToLatest: boolean) => {
      if (!id || !selectedCamera) {
        setFrames([]);
        setFrameIndex(0);
        return;
      }
      try {
        const response = await api.getTimelapseFrames(id, selectedCamera);
        const sorted = sortFramesAscending(response.items);
        setFrames(sorted);
        setFrameIndex((prev) => {
          if (sorted.length === 0) return 0;
          if (stickToLatest || isLive) return sorted.length - 1;
          return Math.max(0, Math.min(prev, sorted.length - 1));
        });
      } catch (error) {
        onNotice({ tone: "error", text: `讀取相機影格失敗：${(error as Error).message}` });
      }
    },
    [id, isLive, onNotice, selectedCamera]
  );

  const reloadJob = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.getJob(id);
      setJob(res.item);
    } catch (error) {
      onNotice({ tone: "error", text: `讀取任務失敗：${(error as Error).message}` });
    }
  }, [id, onNotice]);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);

    api
      .getJob(id)
      .then((res) => {
        if (!cancelled) setJob(res.item);
      })
      .catch((error) => {
        if (!cancelled) {
          setJob(null);
          onNotice({ tone: "error", text: `讀取任務失敗：${(error as Error).message}` });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void reloadTimelapseOverview();

    return () => {
      cancelled = true;
    };
  }, [id, onNotice, reloadTimelapseOverview]);

  useEffect(() => {
    if (!selectedCamera) return;
    void reloadSelectedCameraFrames(true);
  }, [reloadSelectedCameraFrames, selectedCamera]);

  useEffect(() => {
    if (!id || !isLive) return;
    const timer = setInterval(() => {
      void reloadJob();
      void reloadTimelapseOverview();
      void reloadSelectedCameraFrames(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [id, isLive, reloadJob, reloadSelectedCameraFrames, reloadTimelapseOverview]);

  useEffect(() => {
    if (!isPlaying || isLive || frames.length < 2) return;
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev >= frames.length - 1 ? 0 : prev + 1));
    }, playbackMs);
    return () => clearInterval(timer);
  }, [frames.length, isLive, isPlaying, playbackMs]);

  useEffect(() => {
    if (!id) return;

    setLogLines([]);
    setLogConnected(false);
    const source = new EventSource(`/api/jobs/${id}/logs/stream`, { withCredentials: true });

    const onLog = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { data?: { lines?: string[] } };
        const lines = payload.data?.lines ?? [];
        if (lines.length === 0) return;
        setLogLines((prev) => {
          const merged = [...prev, ...lines];
          if (merged.length <= 2000) return merged;
          return merged.slice(merged.length - 2000);
        });
      } catch {}
    };

    source.addEventListener("open", () => {
      setLogConnected(true);
    });
    source.addEventListener("error", () => {
      setLogConnected(false);
    });
    source.addEventListener("log", onLog as EventListener);

    return () => {
      source.close();
      setLogConnected(false);
    };
  }, [id]);

  if (!id) {
    return (
      <section data-route="job-detail" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-100">
        找不到任務 ID。
      </section>
    );
  }

  return (
    <section data-route="job-detail" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline">
          <Link to="/jobs">
            <ArrowLeft className="mr-2 h-4 w-4" /> 返回任務列表
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void reloadJob()}>
            <RefreshCw className="mr-2 h-4 w-4" /> 重新讀取
          </Button>
          <Button asChild>
            <a href={`/api/jobs/${id}/model/download`}>
              <Download className="mr-2 h-4 w-4" /> 下載模型
            </a>
          </Button>
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
        <h2 className="text-lg font-semibold text-zinc-50">訓練進度</h2>
        <div className="mt-3 space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full border border-white/8 bg-white/[0.05]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(103,232,249,0.95),rgba(45,212,191,0.92),rgba(255,255,255,0.85))] transition-[width] duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-300">
            <span>{progress.ratio === null ? "迭代目標未知" : `${progressPercent.toFixed(1)}%`}</span>
            <span>
              iteration {progress.latestIteration}
              {progress.targetIterations ? ` / ${progress.targetIterations}` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-50">Timelapse 檢視器</h2>
          <div className="flex items-center gap-2">
            <Button
              variant={isLive ? "default" : "outline"}
              onClick={() => {
                const next = !isLive;
                setIsLive(next);
                if (next) {
                  setIsPlaying(false);
                  void reloadTimelapseOverview();
                  void reloadSelectedCameraFrames(true);
                }
              }}
            >
              LIVE {isLive ? "ON" : "OFF"}
            </Button>
            <Button variant="outline" onClick={() => void reloadTimelapseOverview()}>
              更新相機
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="text-zinc-400" htmlFor="timelapse-camera">
            相機
          </label>
          <select
            id="timelapse-camera"
            className="h-9 min-w-[180px] rounded-xl border border-white/12 bg-black/20 px-3 text-zinc-100"
            value={selectedCamera}
            onChange={(event) => {
              setSelectedCamera(event.target.value);
              setIsPlaying(false);
            }}
          >
            {cameras.length === 0 ? <option value="">尚無相機</option> : null}
            {cameras.map((camera) => (
              <option key={camera.cameraName} value={camera.cameraName}>
                {camera.cameraName} ({camera.frameCount})
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/40">
          {selectedFrame ? (
            <img
              className="h-[360px] w-full object-contain"
              src={`/api/jobs/${id}/timelapse/frame?path=${encodeURIComponent(selectedFrame.filePath)}`}
              alt={`timelapse-${selectedFrame.cameraName}-${selectedFrame.iteration}`}
            />
          ) : (
            <div className="flex h-[360px] items-center justify-center text-sm text-zinc-500">此相機尚無 timelapse 影格</div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setFrameIndex((prev) => Math.max(0, prev - 1))}
            disabled={isLive || frames.length === 0}
          >
            <SkipBack className="mr-2 h-4 w-4" /> 上一張
          </Button>
          <Button
            onClick={() => {
              if (isLive) return;
              setIsPlaying((prev) => !prev);
            }}
            disabled={isLive || frames.length < 2}
          >
            {isPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {isPlaying ? "暫停" : "播放"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setFrameIndex((prev) => Math.min(frames.length - 1, prev + 1))}
            disabled={isLive || frames.length === 0}
          >
            <SkipForward className="mr-2 h-4 w-4" /> 下一張
          </Button>

          <select
            className="h-9 rounded-xl border border-white/12 bg-black/20 px-3 text-sm text-zinc-100"
            value={String(playbackMs)}
            onChange={(event) => setPlaybackMs(Number(event.target.value))}
            disabled={isLive}
          >
            <option value="1000">1x</option>
            <option value="500">2x</option>
            <option value="250">4x</option>
            <option value="125">8x</option>
          </select>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{frames[0] ? `start: ${frames[0].iteration}` : "start: -"}</span>
            <span>{selectedFrame ? `current: ${selectedFrame.iteration}` : "current: -"}</span>
            <span>{frames[frames.length - 1] ? `end: ${frames[frames.length - 1].iteration}` : "end: -"}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            step={1}
            value={Math.min(frameIndex, Math.max(0, frames.length - 1))}
            disabled={frames.length === 0}
            className="h-2 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            onChange={(event) => {
              const index = Number(event.target.value);
              if (isLive) {
                setIsLive(false);
              }
              setIsPlaying(false);
              setFrameIndex(index);
            }}
          />
        </div>

        <div className="mt-2 text-xs text-zinc-400">
          {selectedFrame
            ? `iteration ${selectedFrame.iteration} | frame ${frameIndex + 1} / ${frames.length} | ${selectedFrame.cameraName}`
            : "尚無可播放影格"}
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
        <h2 className="text-lg font-semibold text-zinc-50">任務詳細</h2>
        {loading ? (
          <p className="mt-2 text-sm text-zinc-400">載入中...</p>
        ) : job ? (
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="text-zinc-500">任務 ID</div>
              <div className="mt-1 font-mono text-zinc-200">{job.id}</div>
            </div>
            <div>
              <div className="text-zinc-500">狀態</div>
              <div className="mt-1">
                <Badge variant={statusBadgeVariant(job.status)}>{statusText(job.status)}</Badge>
              </div>
            </div>
            <div>
              <div className="text-zinc-500">建立時間</div>
              <div className="mt-1 text-zinc-200">{new Date(job.createdAt).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-zinc-500">輸出路徑</div>
              <div className="mt-1 break-all font-mono text-zinc-200">{job.outputPath}</div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-red-200">任務不存在或已被刪除。</p>
        )}
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-base font-semibold text-zinc-50">訓練參數</h3>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">此任務沒有可顯示的參數。</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/8">
            <table className="min-w-full text-sm">
              <thead className="bg-black/30 text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">參數</th>
                  <th className="px-3 py-2 text-left font-medium">值</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([key, value]) => (
                  <tr key={key} className="border-t border-white/8">
                    <td className="px-3 py-2 align-top font-mono text-zinc-300">{key}</td>
                    <td className="px-3 py-2 align-top break-all text-zinc-200">{formatValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-zinc-50">執行 Log</h3>
          <span className="text-xs text-zinc-500">連線狀態：{logConnected ? "已連線" : "未連線"}</span>
        </div>
        <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-white/8 bg-black/40 p-3 text-xs leading-5 text-zinc-200">
          {logLines.length > 0 ? logLines.join("\n") : "尚無 log"}
        </pre>
      </div>
    </section>
  );
}
