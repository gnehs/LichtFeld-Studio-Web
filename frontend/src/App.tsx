import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Database,
  Hourglass,
  ImagePlus,
  ListChecks,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  XCircle
} from "lucide-react";
import { api } from "@/lib/api";
import type { DatasetRecord, JobStatus, TrainingJob, TrainingParamsForm } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type DashboardView = "jobs" | "create";

type MessageTone = "info" | "success" | "error";

interface Notice {
  tone: MessageTone;
  text: string;
}

interface JobInsight {
  latestFramePath: string | null;
  latestIteration: number | null;
}

interface ParsedJobMetrics {
  progress: number | null;
  etaMs: number | null;
}

interface CreateWizardValues {
  iterations: number;
  strategy: "mcmc" | "adc" | "igs+";
  maxCap: number;
  resizeFactor: "auto" | 1 | 2 | 4 | 8;
  eval: boolean;
  saveEvalImages: boolean;
  gut: boolean;
  undistort: boolean;
  timelapseEvery: number;
  logLevel: string;
  advancedJson: string;
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && /unauthorized/i.test(error.message);
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
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
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
  if (!job.paramsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(job.paramsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as TrainingParamsForm;
  } catch {
    return {};
  }
}

function toTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function buildJobMetrics(job: TrainingJob, insight: JobInsight | undefined, nowMs: number): ParsedJobMetrics {
  if (job.status === "completed") {
    return { progress: 1, etaMs: 0 };
  }

  const params = parseJobParams(job);
  const targetIterations = Number(params.iterations ?? 0);
  const latestIteration = Number(insight?.latestIteration ?? 0);

  if (targetIterations <= 0 || latestIteration <= 0) {
    return { progress: null, etaMs: null };
  }

  const progress = clampProgress(latestIteration / targetIterations);
  if (job.status !== "running") {
    return { progress, etaMs: null };
  }

  const startedAt = toTimestamp(job.startedAt);
  if (!startedAt || progress <= 0 || progress >= 1) {
    return { progress, etaMs: null };
  }

  const runMs = nowMs - startedAt;
  if (!Number.isFinite(runMs) || runMs <= 0) {
    return { progress, etaMs: null };
  }

  const totalEstimate = runMs / progress;
  return {
    progress,
    etaMs: Math.max(0, totalEstimate - runMs)
  };
}

function progressText(progress: number | null): string {
  if (progress === null) {
    return "估算中";
  }
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

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    try {
      setError(null);
      await api.login(password);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto mt-24 max-w-md px-4">
      <Card className="relative overflow-hidden border-white/10 bg-black/55">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline">secure console</Badge>
          </div>
          <CardTitle className="font-semibold text-zinc-50">LichtFeld-Studio Web</CardTitle>
          <CardDescription>請輸入管理密碼以進入暗色控制台。</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <Button className="w-full" type="submit">
              Login
            </Button>
          </CardContent>
        </form>
      </Card>
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

function TaskList({
  jobs,
  insights,
  nowMs,
  onCreate,
  onRefresh,
  onStop,
  onDelete
}: {
  jobs: TrainingJob[];
  insights: Record<string, JobInsight>;
  nowMs: number;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  if (jobs.length === 0) {
    return <EmptyState onCreate={onCreate} />;
  }

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
                      <img
                        className="h-20 w-32 rounded-xl border border-white/10 object-cover"
                        src={`/api/jobs/${job.id}/timelapse/frame?path=${encodeURIComponent(thumbnail)}`}
                        alt={`job-${job.id}`}
                      />
                    ) : (
                      <div className="flex h-20 w-32 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">
                        尚無縮圖
                      </div>
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
                      {(job.status === "queued" || job.status === "running") ? (
                        <Button variant="outline" size="sm" onClick={() => void onStop(job.id)}>
                          <Square className="mr-1 h-3.5 w-3.5" /> 停止
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => void onDelete(job.id)}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> 刪除
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

function CreateJobWizard({
  datasets,
  onCancel,
  onCreated,
  onDatasetCreated,
  onNotice
}: {
  datasets: DatasetRecord[];
  onCancel: () => void;
  onCreated: (jobId: string) => Promise<void>;
  onDatasetCreated: (dataset: DatasetRecord) => void;
  onNotice: (notice: Notice) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [dataSourceMode, setDataSourceMode] = useState<"existing" | "upload">("existing");

  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(datasets[0]?.id ?? "");
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedDatasetId, setUploadedDatasetId] = useState("");

  const [form, setForm] = useState<CreateWizardValues>({
    iterations: 30000,
    strategy: "mcmc",
    maxCap: 500000,
    resizeFactor: "auto",
    eval: false,
    saveEvalImages: false,
    gut: false,
    undistort: false,
    timelapseEvery: 100,
    logLevel: "info",
    advancedJson: ""
  });

  const [submitting, setSubmitting] = useState(false);
  const activeDatasetId = dataSourceMode === "existing" ? selectedDatasetId : uploadedDatasetId;

  useEffect(() => {
    if (datasets.length > 0 && !selectedDatasetId) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const uploadZip = async (): Promise<string | null> => {
    if (!uploadFile) {
      onNotice({ tone: "error", text: "請先選擇 zip 檔案" });
      return null;
    }

    setUploading(true);
    try {
      const res = await api.uploadDataset(uploadFile, uploadName.trim() || undefined);
      setUploadedDatasetId(res.item.id);
      onDatasetCreated(res.item);
      onNotice({ tone: "success", text: `資料集 ${res.item.name} 上傳完成` });
      return res.item.id;
    } catch (error) {
      onNotice({ tone: "error", text: `上傳失敗：${(error as Error).message}` });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const goStepTwo = async () => {
    if (dataSourceMode === "existing") {
      if (!selectedDatasetId) {
        onNotice({ tone: "error", text: "請先選擇一個 dataset" });
        return;
      }
      setStep(2);
      return;
    }

    const datasetId = uploadedDatasetId || (await uploadZip());
    if (!datasetId) {
      return;
    }
    setStep(2);
  };

  const updateForm = <K extends keyof CreateWizardValues>(key: K, value: CreateWizardValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    if (!activeDatasetId) {
      onNotice({ tone: "error", text: "請先完成資料集步驟" });
      setStep(1);
      return;
    }

    let advanced: Partial<TrainingParamsForm> = {};
    if (form.advancedJson.trim()) {
      try {
        const parsed = JSON.parse(form.advancedJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("進階參數必須是 JSON 物件");
        }
        advanced = parsed as Partial<TrainingParamsForm>;
      } catch (error) {
        onNotice({ tone: "error", text: `進階參數 JSON 格式錯誤：${(error as Error).message}` });
        return;
      }
    }

    const payloadParams: TrainingParamsForm = {
      ...advanced,
      iterations: form.iterations,
      strategy: form.strategy,
      maxCap: form.maxCap,
      resizeFactor: form.resizeFactor,
      eval: form.eval,
      saveEvalImages: form.saveEvalImages,
      gut: form.gut,
      undistort: form.undistort,
      logLevel: form.logLevel.trim() || undefined,
      timelapse: {
        images: [],
        every: form.timelapseEvery
      }
    };

    delete payloadParams.dataPath;

    setSubmitting(true);
    try {
      const res = await api.createJob({
        datasetId: activeDatasetId,
        params: payloadParams
      });
      onNotice({ tone: "success", text: `任務 ${res.item.id} 建立成功` });
      await onCreated(res.item.id);
    } catch (error) {
      onNotice({ tone: "error", text: `建立任務失敗：${(error as Error).message}` });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDataset = useMemo(() => datasets.find((item) => item.id === activeDatasetId), [datasets, activeDatasetId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">建立新任務</h2>
          <p className="text-sm text-zinc-400">兩步驟流程：先準備資料，再設定訓練參數。</p>
        </div>
        <Button variant="outline" onClick={onCancel}>
          返回任務清單
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className={`rounded-[1.15rem] border p-4 ${step === 1 ? "border-cyan-400/30 bg-cyan-400/[0.08]" : "border-white/10 bg-white/[0.03]"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Database className="h-4 w-4" /> Step 1：上傳或選擇資料集
          </div>
          <p className="mt-1 text-xs text-zinc-400">不需要也不允許手動輸入資料路徑。</p>
        </div>
        <div className={`rounded-[1.15rem] border p-4 ${step === 2 ? "border-cyan-400/30 bg-cyan-400/[0.08]" : "border-white/10 bg-white/[0.03]"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Sparkles className="h-4 w-4" /> Step 2：參數設定
          </div>
          <p className="mt-1 text-xs text-zinc-400">Timelapse 會自動啟用，只調整間隔即可。</p>
        </div>
      </div>

      {step === 1 ? (
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-xl">資料集來源</CardTitle>
            <CardDescription>你可以直接上傳 zip，或從既有 dataset 清單挑選。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button variant={dataSourceMode === "existing" ? "default" : "outline"} onClick={() => setDataSourceMode("existing")}>
                從既有資料集選擇
              </Button>
              <Button variant={dataSourceMode === "upload" ? "default" : "outline"} onClick={() => setDataSourceMode("upload")}>
                上傳 zip
              </Button>
            </div>

            {dataSourceMode === "existing" ? (
              <div className="space-y-3">
                <Label>選擇 dataset</Label>
                <select
                  className="h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100"
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                >
                  <option value="">請選擇</option>
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} ({dataset.type})
                    </option>
                  ))}
                </select>
                {datasets.length === 0 ? <p className="text-sm text-amber-200">目前沒有可用 dataset，請切換到「上傳 zip」。</p> : null}
              </div>
            ) : (
              <div className="space-y-3 rounded-[1.15rem] border border-white/10 bg-black/20 p-4">
                <div className="rounded-[1rem] border border-cyan-400/15 bg-cyan-400/[0.08] p-3 text-sm text-zinc-300">
                  <p className="font-medium text-zinc-50">ZIP 內的資料夾結構需求</p>
                  <p className="mt-1">解壓後的根目錄必須直接包含 <code className="rounded bg-black/40 px-1 py-0.5 text-xs">images/</code> 與 <code className="rounded bg-black/40 px-1 py-0.5 text-xs">sparse/</code>。</p>
                  <pre className="scrollbar-dark mt-3 overflow-x-auto rounded-xl border border-white/8 bg-black/80 p-3 text-xs leading-5 text-zinc-100">
{`dataset.zip
|- images/
|  |- 0001.jpg
|  |- 0002.jpg
|  \- ...
\- sparse/
   \- ...`}
                  </pre>
                  <p className="mt-2 text-xs text-zinc-400">請不要再多包一層外層資料夾，例如 <code className="rounded bg-black/40 px-1 py-0.5">dataset/images</code>。</p>
                </div>
                <div>
                  <Label>名稱（可選）</Label>
                  <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="例如：garden-v2" />
                </div>
                <div>
                  <Label>ZIP 檔案</Label>
                  <Input type="file" accept=".zip" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => void uploadZip()} disabled={uploading}>
                    <UploadCloud className="mr-2 h-4 w-4" /> {uploading ? "上傳中..." : "先上傳 dataset"}
                  </Button>
                  {uploadedDatasetId ? <span className="text-xs text-emerald-200">已完成上傳並選取此 dataset</span> : null}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => void goStepTwo()}>
                下一步：參數設定
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-xl">訓練參數設定</CardTitle>
            <CardDescription>
              目前資料集：<span className="font-medium text-zinc-50">{selectedDataset?.name ?? "未選擇"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2 rounded-[1.1rem] border border-white/10 bg-black/25 p-4">
                <Label>Iterations</Label>
                <input
                  type="range"
                  min={5000}
                  max={200000}
                  step={1000}
                  value={form.iterations}
                  onChange={(e) => updateForm("iterations", Number(e.target.value))}
                  className="range-dark w-full"
                />
                <div className="text-sm text-zinc-400">{form.iterations.toLocaleString()} steps</div>
              </div>

              <div className="space-y-2 rounded-[1.1rem] border border-white/10 bg-black/25 p-4">
                <Label>Max Cap</Label>
                <input
                  type="range"
                  min={100000}
                  max={1000000}
                  step={50000}
                  value={form.maxCap}
                  onChange={(e) => updateForm("maxCap", Number(e.target.value))}
                  className="range-dark w-full"
                />
                <div className="text-sm text-zinc-400">{form.maxCap.toLocaleString()}</div>
              </div>

              <div className="space-y-2">
                <Label>Strategy</Label>
                <div className="flex flex-wrap gap-2">
                  {(["mcmc", "adc", "igs+"] as const).map((strategy) => (
                    <Button
                      key={strategy}
                      variant={form.strategy === strategy ? "default" : "outline"}
                      onClick={() => updateForm("strategy", strategy)}
                      type="button"
                    >
                      {strategy}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Resize Factor</Label>
                <select
                  className="mt-2 h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100"
                  value={String(form.resizeFactor)}
                  onChange={(e) => {
                    const value = e.target.value;
                    updateForm("resizeFactor", value === "auto" ? "auto" : (Number(value) as 1 | 2 | 4 | 8));
                  }}
                >
                  <option value="auto">auto</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                </select>
              </div>

              <div>
                <Label>Timelapse 間隔（自動啟用）</Label>
                <Input
                  className="mt-2"
                  type="number"
                  min={10}
                  step={10}
                  value={form.timelapseEvery}
                  onChange={(e) => updateForm("timelapseEvery", Number(e.target.value || 100))}
                />
              </div>

              <div>
                <Label>Log Level</Label>
                <Input className="mt-2" value={form.logLevel} onChange={(e) => updateForm("logLevel", e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
                <input type="checkbox" checked={form.eval} onChange={(e) => updateForm("eval", e.target.checked)} /> --eval
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
                <input type="checkbox" checked={form.saveEvalImages} onChange={(e) => updateForm("saveEvalImages", e.target.checked)} /> --save-eval-images
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
                <input type="checkbox" checked={form.gut} onChange={(e) => updateForm("gut", e.target.checked)} /> --gut
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
                <input type="checkbox" checked={form.undistort} onChange={(e) => updateForm("undistort", e.target.checked)} /> --undistort
              </label>
            </div>

            <div>
              <Label>進階參數 JSON（可選）</Label>
              <Textarea
                className="mt-2 min-h-[160px] font-mono text-xs"
                placeholder='{"testEvery": 500, "enableMip": true}'
                value={form.advancedJson}
                onChange={(e) => updateForm("advancedJson", e.target.value)}
              />
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                返回 Step 1
              </Button>
              <Button onClick={() => void submit()} disabled={submitting}>
                {submitting ? "建立中..." : "建立任務"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function noticeClassName(tone: MessageTone): string {
  if (tone === "success") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-100";
  if (tone === "error") return "border-red-500/20 bg-red-500/10 text-red-100";
  return "border-cyan-400/20 bg-cyan-400/10 text-cyan-100";
}

function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<DashboardView>("jobs");
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [insights, setInsights] = useState<Record<string, JobInsight>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const setNoticeText = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const refreshDatasets = useCallback(async () => {
    const res = await api.listDatasets();
    setDatasets(res.items);
  }, []);

  const refreshJobs = useCallback(async () => {
    const res = await api.listJobs();
    setJobs(res.items);

    if (res.items.length === 0) {
      setInsights({});
      return;
    }

    const settled = await Promise.allSettled(
      res.items.map(async (job) => {
        const latest = await api.getTimelapseLatest(job.id);
        const newest = latest.items.reduce<{ filePath: string | null; iteration: number | null }>(
          (acc, frame) => {
            if (!acc.iteration || frame.iteration > acc.iteration) {
              return { filePath: frame.filePath, iteration: frame.iteration };
            }
            return acc;
          },
          { filePath: null, iteration: null }
        );

        return {
          id: job.id,
          value: {
            latestFramePath: newest.filePath,
            latestIteration: newest.iteration
          }
        };
      })
    );

    const next: Record<string, JobInsight> = {};
    settled.forEach((result, index) => {
      const jobId = res.items[index]?.id;
      if (!jobId) {
        return;
      }

      if (result.status === "fulfilled") {
        next[result.value.id] = result.value.value;
      } else {
        next[jobId] = {
          latestFramePath: null,
          latestIteration: null
        };
      }
    });

    setInsights(next);
  }, []);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authed) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        await Promise.all([refreshDatasets(), refreshJobs()]);
      } catch (error) {
        if (!cancelled && isUnauthorizedError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          try {
            await Promise.all([refreshDatasets(), refreshJobs()]);
            return;
          } catch (retryError) {
            if (!cancelled && isUnauthorizedError(retryError)) {
              setAuthed(false);
              return;
            }
            if (!cancelled) {
              setNoticeText({ tone: "error", text: `讀取資料失敗：${(retryError as Error).message}` });
            }
            return;
          }
        }
        if (!cancelled) {
          setNoticeText({ tone: "error", text: `讀取資料失敗：${(error as Error).message}` });
        }
      }
    };

    void load();

    const timer = setInterval(() => {
      void refreshJobs().catch((error) => {
        if (!cancelled && isUnauthorizedError(error)) {
          setAuthed(false);
          return;
        }
        if (!cancelled) {
          setNoticeText({ tone: "error", text: `任務更新失敗：${(error as Error).message}` });
        }
      });
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authed, refreshDatasets, refreshJobs, setNoticeText]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!ready) {
    return <div className="p-8 text-zinc-300">Loading...</div>;
  }

  if (!authed) {
    return <LoginView onLogin={() => setAuthed(true)} />;
  }

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;

  return (
    <div className="min-h-screen bg-app-base pb-8 text-zinc-100">
      <header className="border-b border-white/10 bg-black/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">LichtFeld-Studio 任務控制台</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant={view === "jobs" ? "default" : "outline"} onClick={() => setView("jobs")}>
              <ListChecks className="mr-2 h-4 w-4" /> 任務首頁
            </Button>
            <Button variant={view === "create" ? "default" : "outline"} onClick={() => setView("create")}>
              <ImagePlus className="mr-2 h-4 w-4" /> 建立任務
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.logout();
                setAuthed(false);
              }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-4 max-w-7xl space-y-4 px-4">
        {view === "jobs" ? (
          <section className="panel-grid noise-overlay relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <div className="grid gap-3 md:grid-cols-[1.6fr_1fr]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">overview</p>
                <h2 className="mt-2 max-w-2xl text-2xl font-semibold leading-tight text-zinc-50">訓練控制台</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">即時監看任務進度、排隊狀態與資料集操作。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">running</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{runningCount}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">queued</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{queuedCount}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">datasets</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{datasets.length}</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        {notice ? (
          <div className={`rounded-xl border px-4 py-3 text-sm ${noticeClassName(notice.tone)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                {notice.tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : null}
                {notice.tone === "error" ? <XCircle className="h-4 w-4" /> : null}
                {notice.tone === "info" ? <Sparkles className="h-4 w-4" /> : null}
                <span>{notice.text}</span>
              </div>
                <button className="text-xs underline underline-offset-4" onClick={() => setNotice(null)}>
                  關閉
                </button>
            </div>
          </div>
        ) : null}

        {view === "jobs" ? (
          <TaskList
            jobs={jobs}
            insights={insights}
            nowMs={nowMs}
            onCreate={() => setView("create")}
            onRefresh={refreshJobs}
            onStop={async (id) => {
              try {
                await api.stopJob(id);
                setNoticeText({ tone: "success", text: `任務 ${id} 已送出停止指令` });
                await refreshJobs();
              } catch (error) {
                setNoticeText({ tone: "error", text: `停止任務失敗：${(error as Error).message}` });
              }
            }}
            onDelete={async (id) => {
              const ok = window.confirm("確定要刪除此任務？\n按「確定」會保留 Timelapse 檔案。");
              if (!ok) {
                return;
              }
              try {
                await api.deleteJob(id, false);
                setNoticeText({ tone: "success", text: `任務 ${id} 已刪除` });
                await refreshJobs();
              } catch (error) {
                setNoticeText({ tone: "error", text: `刪除失敗：${(error as Error).message}` });
              }
            }}
          />
        ) : (
          <CreateJobWizard
            datasets={datasets}
            onCancel={() => setView("jobs")}
            onDatasetCreated={(dataset) => {
              setDatasets((prev) => {
                const without = prev.filter((item) => item.id !== dataset.id);
                return [dataset, ...without];
              });
            }}
            onCreated={async () => {
              setView("jobs");
              await Promise.all([refreshDatasets(), refreshJobs()]);
            }}
            onNotice={setNoticeText}
          />
        )}
      </main>
    </div>
  );
}

export default App;
