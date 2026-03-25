import { Plus, RefreshCw, Square, Trash2, ListChecks } from "lucide-react";
import type { JobInsight } from "@/lib/app-types";
import type { JobStatus, TrainingJob, TrainingParamsForm } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ParsedJobMetrics {
  progress: number | null;
  etaMs: number | null;
}

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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
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

function buildJobMetrics(job: TrainingJob, insight: JobInsight | undefined, nowMs: number): ParsedJobMetrics {
  if (job.status === "completed") return { progress: 1, etaMs: 0 };
  const params = parseJobParams(job);
  const targetIterations = Number(params.iterations ?? 0);
  const latestIteration = Number(insight?.latestIteration ?? 0);
  if (targetIterations <= 0 || latestIteration <= 0) return { progress: null, etaMs: null };
  const progress = clampProgress(latestIteration / targetIterations);
  if (job.status !== "running") return { progress, etaMs: null };
  const startedAt = toTimestamp(job.startedAt);
  if (!startedAt || progress <= 0 || progress >= 1) return { progress, etaMs: null };
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
  const width = progress === null ? 15 : Math.round(clampProgress(progress) * 100);
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
    <div className="rounded-[1.5rem] border border-dashed border-white/12 bg-white/[0.03] p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
        <ListChecks className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-2xl font-semibold text-zinc-50">目前還沒有任務</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">上傳 zip 或選擇既有 dataset 後，即可建立新任務並在這裡追蹤縮圖、進度、執行時間與 ETA。</p>
      <Button className="mt-6" onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" /> 新增任務
      </Button>
    </div>
  );
}

export function TaskList({
  jobs,
  insights,
  nowMs,
  onCreate,
  onRefresh,
  onStop,
  onDelete,
  onOpenDetail
}: {
  jobs: TrainingJob[];
  insights: Record<string, JobInsight>;
  nowMs: number;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetail: (id: string) => void;
}) {
  if (jobs.length === 0) return <EmptyState onCreate={onCreate} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">任務清單</h2>
          <p className="text-sm text-zinc-400">首頁即時更新目前訓練狀態與 Timelapse 縮圖。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void onRefresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> 重新整理
          </Button>
          <Button onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" /> 新增任務
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03] shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
        <Table>
          <TableHeader>
            <TableRow className="bg-white/[0.03]">
              <TableHead>任務</TableHead>
              <TableHead>縮圖</TableHead>
              <TableHead>進度</TableHead>
              <TableHead>執行時間</TableHead>
              <TableHead>經過時間</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const insight = insights[job.id];
              const metrics = buildJobMetrics(job, insight, nowMs);
              const createdAt = toTimestamp(job.createdAt);
              const startedAt = toTimestamp(job.startedAt);
              const finishedAt = toTimestamp(job.finishedAt);
              const endTs = finishedAt ?? nowMs;
              const elapsedFromCreate = createdAt ? Math.max(0, endTs - createdAt) : null;
              const runElapsed = startedAt ? Math.max(0, endTs - startedAt) : null;
              const thumbnail = insight?.latestFramePath;

              return (
                <TableRow key={job.id} className="align-top">
                  <TableCell>
                    <div className="space-y-2">
                      <div className="font-mono text-[11px] text-zinc-500">{job.id}</div>
                      <Badge variant={statusBadgeVariant(job.status)}>{statusText(job.status)}</Badge>
                      <div className="text-xs text-zinc-500">建立於 {new Date(job.createdAt).toLocaleString()}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {thumbnail ? (
                      <img className="h-20 w-32 rounded-xl border border-white/10 object-cover" src={`/api/jobs/${job.id}/timelapse/frame?path=${encodeURIComponent(thumbnail)}`} alt={`job-${job.id}`} />
                    ) : (
                      <div className="flex h-20 w-32 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">尚無縮圖</div>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    <div className="space-y-2">
                      <ProgressBar progress={metrics.progress} />
                      <div className="text-xs text-zinc-400">{progressText(metrics.progress)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-300">{formatDuration(runElapsed)}</TableCell>
                  <TableCell className="text-sm text-zinc-300">{formatDuration(elapsedFromCreate)}</TableCell>
                  <TableCell className="text-sm text-zinc-300">{formatEta(metrics.etaMs)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {job.status === "queued" || job.status === "running" ? (
                        <Button variant="outline" size="sm" onClick={() => void onStop(job.id)}>
                          <Square className="mr-1 h-3.5 w-3.5" /> 停止
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => void onDelete(job.id)}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> 刪除
                      </Button>
                      <Button size="sm" onClick={() => onOpenDetail(job.id)}>
                        查看詳細
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
