import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Notice } from "@/lib/app-types";
import type { JobStatus, TrainingJob } from "@/lib/types";

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

  const params = useMemo(() => parseJobParams(job), [job]);
  const entries = useMemo(() => Object.entries(params).sort(([a], [b]) => a.localeCompare(b)), [params]);

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

    return () => {
      cancelled = true;
    };
  }, [id, onNotice]);

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
