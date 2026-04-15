import { useState } from "react";
import { Plus, RefreshCw, Square, Trash2, ListChecks, RotateCcw, Pencil } from "lucide-react";
import type { JobInsight } from "@/lib/app-types";
import type { JobStatus, TrainingJob, TrainingParamsForm } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ParsedJobMetrics {
  progress: number | null;
  etaMs: number | null;
}

type TaskFilter = "all" | "running" | "queued" | "completed" | "failed" | "stopped";

const TASK_FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "running", label: "訓練中" },
  { key: "queued", label: "佇列" },
  { key: "completed", label: "完成" },
  { key: "failed", label: "失敗" },
  { key: "stopped", label: "已停止" },
];

function isFailureStatus(status: JobStatus): boolean {
  return status === "failed" || status === "stopped_low_disk";
}

function isStoppedStatus(status: JobStatus): boolean {
  return status === "stopped";
}

function isTerminalStatus(status: JobStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "stopped" ||
    status === "stopped_low_disk"
  );
}

function statusBadgeVariant(
  status: JobStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "stopped_low_disk")
    return "destructive";
  if (status === "running") return "default";
  if (status === "queued") return "secondary";
  return "outline";
}

function statusText(status: JobStatus): string {
  if (status === "queued") return "佇列";
  if (status === "running") return "訓練中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失敗";
  if (status === "stopped") return "已停止";
  return "低磁碟空間中止";
}

function matchesTaskFilter(status: JobStatus, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "failed") return isFailureStatus(status);
  if (filter === "stopped") return isStoppedStatus(status);
  return status === filter;
}

function filterEmptyText(filter: TaskFilter): string {
  const entry = TASK_FILTERS.find((item) => item.key === filter);
  return entry?.label ?? "目前條件";
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "-";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatEta(ms: number | null): string {
  if (ms === null) return "-";
  if (ms <= 0) return "即將完成";
  return formatDuration(ms);
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseJobParams(job: TrainingJob): TrainingParamsForm {
  if (!job.paramsJson) return {};
  try {
    const parsed = JSON.parse(job.paramsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as TrainingParamsForm;
  } catch {
    return {};
  }
}

function toTimestamp(value: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function buildJobMetrics(
  job: TrainingJob,
  insight: JobInsight | undefined,
  nowMs: number,
): ParsedJobMetrics {
  if (job.status === "completed") return { progress: 1, etaMs: 0 };
  const params = parseJobParams(job);
  const targetIterations = Number(params.iterations ?? 0);
  const latestIteration = Number(insight?.latestIteration ?? 0);
  if (targetIterations <= 0 || latestIteration <= 0)
    return { progress: null, etaMs: null };
  const progress = clampProgress(latestIteration / targetIterations);
  if (job.status !== "running") return { progress, etaMs: null };
  const startedAt = toTimestamp(job.startedAt);
  if (!startedAt || progress <= 0 || progress >= 1)
    return { progress, etaMs: null };
  const runMs = nowMs - startedAt;
  if (!Number.isFinite(runMs) || runMs <= 0) return { progress, etaMs: null };
  const totalEstimate = runMs / progress;
  return { progress, etaMs: Math.max(0, totalEstimate - runMs) };
}

function progressText(progress: number | null): string {
  if (progress === null) return "估算中";
  return `${(progress * 100).toFixed(1)}%`;
}

function ProgressBar({ progress }: { progress: number | null }) {
  const width =
    progress === null ? 15 : Math.round(clampProgress(progress) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full border border-white/8 bg-white/[0.05]">
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,rgba(103,232,249,0.95),rgba(45,212,191,0.92),rgba(255,255,255,0.85))] shadow-[0_0_18px_rgba(103,232,249,0.25)] transition-[width] duration-500"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glass-panel rounded-[1.5rem] p-8 text-center backdrop-blur-xl">
      <div className="relative z-10 flex flex-col items-center">
        <div className="glass-panel mx-auto flex h-12 w-12 items-center justify-center rounded-full">
          <div className="icon-mask text-cyan-200">
            <ListChecks className="h-7 w-7" />
          </div>
        </div>
        <h2 className="relative mt-4 text-2xl font-semibold text-zinc-50">
          目前還沒有任務
        </h2>
        <p className="relative mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">
          上傳 zip 或選擇既有 dataset
          後，即可建立新任務並在這裡追蹤縮圖、進度、執行時間與 ETA。
        </p>
        <Button className="relative mt-6" onClick={onCreate}>
          <Plus className="size-4" /> 新增任務
        </Button>
      </div>
    </div>
  );
}

export function TaskList({
  jobs,
  insights,
  nowMs,
  isLoading,
  onCreate,
  onRefresh,
  onStop,
  onDelete,
  onOpenDetail,
  onRetry,
  onEdit,
}: {
  jobs: TrainingJob[];
  insights: Record<string, JobInsight>;
  nowMs: number;
  isLoading?: boolean;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetail: (id: string) => void;
  onRetry: (job: TrainingJob) => Promise<void>;
  onEdit: (job: TrainingJob) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("all");

  if (isLoading) {
    return (
      <div className="glass-panel rounded-[1.5rem] p-8 text-center backdrop-blur-xl">
        <p className="text-sm text-zinc-400">正在載入任務...</p>
      </div>
    );
  }

  if (jobs.length === 0) return <EmptyState onCreate={onCreate} />;

  const filteredJobs = jobs.filter((job) =>
    matchesTaskFilter(job.status, activeFilter),
  );
  const filterOptions = TASK_FILTERS.map((filter) => ({
    ...filter,
    count: jobs.filter((job) => matchesTaskFilter(job.status, filter.key))
      .length,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((filter) => {
              const active = filter.key === activeFilter;
              return (
                <Button
                  key={filter.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "rounded-2xl border-white/10 bg-black/10 text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]",
                    active && "bg-primary/25",
                  )}
                  onClick={() => setActiveFilter(filter.key)}
                >
                  <span>{filter.label}</span>
                  <span className="glass-panel relative rounded-full bg-current/5 px-1.5 py-0.5 text-[10px] leading-none opacity-80">
                    {filter.count}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void onRefresh()}>
            <RefreshCw className="size-4" /> 重新整理
          </Button>
          <Button onClick={onCreate}>
            <Plus className="size-4" /> 新增任務
          </Button>
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="glass-panel relative overflow-hidden rounded-[1.5rem] p-8 text-center backdrop-blur-xl">
          <div className="relative z-10">
            <p className="relative text-base font-medium text-zinc-100">
              目前沒有符合「{filterEmptyText(activeFilter)}」的任務
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              切換其他狀態，或直接建立新的訓練任務。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveFilter("all")}
              >
                查看全部
              </Button>
              <Button size="sm" onClick={onCreate}>
                <Plus className="size-4" /> 新增任務
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredJobs.map((job) => {
            const insight = insights[job.id];
            const metrics = buildJobMetrics(job, insight, nowMs);
            const startedAt = toTimestamp(job.startedAt);
            const finishedAt = toTimestamp(job.finishedAt);
            const endTs = finishedAt ?? nowMs;
            const runElapsed = startedAt
              ? Math.max(0, endTs - startedAt)
              : null;
            const thumbnail = insight?.latestFramePath;

            return (
              <article
                key={job.id}
                data-job-card
                className="glass-panel relative rounded-2xl p-3 backdrop-blur-xl"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px rounded-2xl bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(103,232,249,0.25),rgba(255,255,255,0))]" />
                <div className="relative z-10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="font-mono text-[11px] break-all text-zinc-500">
                        {job.id}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <Badge variant={statusBadgeVariant(job.status)}>
                      {statusText(job.status)}
                    </Badge>
                  </div>

                  <div className="glass-panel mt-2 overflow-hidden rounded-xl bg-black/25">
                    {thumbnail ? (
                      <img
                        className="h-40 w-full object-cover"
                        src={`/api/jobs/${job.id}/timelapse/frame?path=${encodeURIComponent(thumbnail)}`}
                        alt={`job-${job.id}`}
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_55%)] text-sm text-zinc-500">
                        尚無縮圖
                      </div>
                    )}
                  </div>

                  <div className="glass-panel mt-4 rounded-xl bg-black/20 p-3">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>進度</span>
                      <span>{progressText(metrics.progress)}</span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar progress={metrics.progress} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="glass-panel rounded-xl bg-black/15 p-3">
                      <div className="text-xs text-zinc-500">執行時間</div>
                      <div className="text-base font-medium text-zinc-100">
                        {formatDuration(runElapsed)}
                      </div>
                    </div>
                    <div className="glass-panel rounded-xl bg-black/15 p-3">
                      <div className="text-xs text-zinc-500">
                        {isTerminalStatus(job.status) ? "狀態" : "預計剩餘時間"}
                      </div>
                      <div className="text-base font-medium text-zinc-100">
                        {isTerminalStatus(job.status)
                          ? statusText(job.status)
                          : formatEta(metrics.etaMs)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-white/8 pt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void onDelete(job.id)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> 刪除
                    </Button>
                    <div className="flex items-center gap-2">
                      {job.status === "queued" || job.status === "running" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void onStop(job.id)}
                        >
                          <Square className="mr-1 h-3.5 w-3.5" /> 停止
                        </Button>
                      ) : null}
                      {isTerminalStatus(job.status) ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void onRetry(job)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重試
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onEdit(job)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" /> 編輯
                          </Button>
                        </>
                      ) : null}
                      <Button size="sm" onClick={() => onOpenDetail(job.id)}>
                        查看詳細
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
