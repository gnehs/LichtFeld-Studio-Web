import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, Database, LogOut, Play, Server, Square } from "lucide-react";
import { api } from "@/lib/api";
import type { DatasetRecord, EventMessage, TimelapseFrame, TrainingJob, TrainingParamsForm } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

function statusBadgeVariant(status: TrainingJob["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "stopped_low_disk") return "destructive";
  if (status === "running") return "default";
  if (status === "queued") return "secondary";
  return "outline";
}

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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
      <Card>
        <CardHeader>
          <CardTitle>LichtFeld-Studio Web</CardTitle>
          <CardDescription>請輸入管理密碼</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button className="w-full" onClick={submit}>
            Login
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"datasets" | "create" | "jobs" | "detail">("datasets");

  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setReady(true));
  }, []);

  const refreshDatasets = async () => {
    const res = await api.listDatasets();
    setDatasets(res.items);
  };

  const refreshJobs = async () => {
    const res = await api.listJobs();
    setJobs(res.items);
    if (!selectedJobId && res.items.length > 0) {
      setSelectedJobId(res.items[0].id);
    }
  };

  useEffect(() => {
    if (!authed) return;
    refreshDatasets();
    refreshJobs();
    const timer = setInterval(refreshJobs, 3000);
    return () => clearInterval(timer);
  }, [authed]);

  if (!ready) {
    return <div className="p-8">Loading...</div>;
  }

  if (!authed) {
    return <LoginView onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-4">
          <div>
            <h1 className="text-xl font-semibold">LichtFeld-Studio Web Console</h1>
            <p className="text-sm text-muted-foreground">Remote 3DGS Training + Timelapse</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={tab === "datasets" ? "default" : "outline"} onClick={() => setTab("datasets")}>
              <Database className="mr-2 h-4 w-4" /> Datasets
            </Button>
            <Button variant={tab === "create" ? "default" : "outline"} onClick={() => setTab("create")}>
              <Play className="mr-2 h-4 w-4" /> 新任務
            </Button>
            <Button variant={tab === "jobs" ? "default" : "outline"} onClick={() => setTab("jobs")}>
              <Server className="mr-2 h-4 w-4" /> 任務
            </Button>
            <Button variant={tab === "detail" ? "default" : "outline"} onClick={() => setTab("detail")}>
              <Camera className="mr-2 h-4 w-4" /> Timelapse
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

      <main className="mx-auto max-w-7xl space-y-4 p-4">
        {message ? (
          <Card className="border-blue-300 bg-blue-50">
            <CardContent className="p-3 text-sm">{message}</CardContent>
          </Card>
        ) : null}

        {tab === "datasets" ? <DatasetsPanel datasets={datasets} onRefresh={refreshDatasets} onMessage={setMessage} /> : null}
        {tab === "create" ? (
          <CreateJobPanel
            datasets={datasets}
            jobs={jobs}
            onCreated={(jobId) => {
              setSelectedJobId(jobId);
              setTab("detail");
              refreshJobs();
            }}
            onMessage={setMessage}
          />
        ) : null}
        {tab === "jobs" ? (
          <JobsPanel
            jobs={jobs}
            onSelect={(id) => {
              setSelectedJobId(id);
              setTab("detail");
            }}
            onRefresh={refreshJobs}
          />
        ) : null}
        {tab === "detail" ? <JobDetailPanel jobId={selectedJobId} jobs={jobs} onRefreshJobs={refreshJobs} /> : null}
      </main>
    </div>
  );
}

function DatasetsPanel({
  datasets,
  onRefresh,
  onMessage
}: {
  datasets: DatasetRecord[];
  onRefresh: () => void;
  onMessage: (v: string) => void;
}) {
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [registerName, setRegisterName] = useState("");
  const [registerPath, setRegisterPath] = useState("");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>上傳 Dataset</CardTitle>
          <CardDescription>上傳 zip，後端會檢查 COLMAP 結構（images/ + sparse/）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>名稱（可選）</Label>
            <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
          </div>
          <div>
            <Label>ZIP 檔案</Label>
            <Input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button
            onClick={async () => {
              if (!file) {
                onMessage("請先選擇 zip 檔案");
                return;
              }
              await api.uploadDataset(file, uploadName || undefined);
              onMessage("Dataset 上傳完成");
              onRefresh();
            }}
          >
            上傳
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>註冊既有路徑</CardTitle>
          <CardDescription>僅允許 `DATASET_ALLOWED_ROOTS` 內的路徑</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>名稱</Label>
            <Input value={registerName} onChange={(e) => setRegisterName(e.target.value)} />
          </div>
          <div>
            <Label>伺服器路徑</Label>
            <Input value={registerPath} onChange={(e) => setRegisterPath(e.target.value)} placeholder="/app/data/datasets/scene1" />
          </div>
          <Button
            onClick={async () => {
              await api.registerDatasetPath(registerName, registerPath);
              onMessage("路徑註冊完成");
              onRefresh();
            }}
          >
            註冊
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Dataset 清單</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Path</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell>{d.type}</TableCell>
                  <TableCell className="font-mono text-xs">{d.path}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

const ALL_PARAMS_TEMPLATE: Record<string, unknown> = {
  dataPath: "",
  outputPath: "",
  configPath: "",
  configJson: "",
  resume: "",
  init: "",
  importCameras: "",
  iterations: 30000,
  strategy: "mcmc",
  shDegree: null,
  shDegreeInterval: null,
  maxCap: 500000,
  minOpacity: null,
  stepsScaler: null,
  tileMode: 1,
  random: false,
  initNumPts: null,
  initExtent: null,
  images: "",
  testEvery: null,
  resizeFactor: "auto",
  maxWidth: null,
  noCpuCache: false,
  noFsCache: false,
  undistort: false,
  maskMode: "none",
  invertMasks: false,
  noAlphaAsMask: false,
  enableSparsity: false,
  sparsifySteps: null,
  initRho: null,
  pruneRatio: null,
  enableMip: false,
  bilateralGrid: false,
  ppisp: false,
  ppispController: false,
  ppispFreeze: false,
  ppispSidecar: "",
  bgModulation: false,
  gut: false,
  eval: false,
  saveEvalImages: false,
  saveDepth: false,
  headless: true,
  train: true,
  noSplash: false,
  noInterop: false,
  debugPython: false,
  debugPythonPort: null,
  logLevel: "",
  verbose: false,
  quiet: false,
  logFile: "",
  logFilter: "",
  pythonScripts: [],
  timelapse: {
    images: ["IMG_6672.JPG", "IMG_6690.JPG"],
    every: 100
  }
};

function serializeParamsEditor(params: TrainingParamsForm): string {
  const merged = {
    ...ALL_PARAMS_TEMPLATE,
    ...params,
    timelapse: {
      ...(ALL_PARAMS_TEMPLATE.timelapse as Record<string, unknown>),
      ...(params.timelapse ?? {})
    }
  };
  return JSON.stringify(merged, null, 2);
}

function normalizeParsedParams(raw: unknown): TrainingParamsForm {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("參數 JSON 必須是物件");
  }

  const clean = (value: unknown): unknown => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    if (Array.isArray(value)) {
      const arr = value.map(clean).filter((v) => v !== undefined);
      return arr.length > 0 ? arr : undefined;
    }
    if (typeof value === "object") {
      const obj: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const cleaned = clean(child);
        if (cleaned !== undefined) {
          obj[key] = cleaned;
        }
      }
      return Object.keys(obj).length > 0 ? obj : undefined;
    }
    return value;
  };

  const cleaned = clean(raw);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    return { headless: true, train: true };
  }

  const params = cleaned as TrainingParamsForm;
  params.headless = true;
  params.train = true;

  if (params.timelapse) {
    const images = Array.isArray(params.timelapse.images)
      ? params.timelapse.images.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const every = Number(params.timelapse.every ?? 50);
    params.timelapse = {
      images,
      every: Number.isFinite(every) ? every : 50
    };
  }

  if (params.pythonScripts) {
    params.pythonScripts = params.pythonScripts.map((value) => String(value).trim()).filter(Boolean);
  }

  return params;
}

function CreateJobPanel({
  datasets,
  jobs,
  onCreated,
  onMessage
}: {
  datasets: DatasetRecord[];
  jobs: TrainingJob[];
  onCreated: (id: string) => void;
  onMessage: (v: string) => void;
}) {
  const [datasetId, setDatasetId] = useState("");
  const [copyFromJobId, setCopyFromJobId] = useState("");
  const [params, setParams] = useState<TrainingParamsForm>(() => normalizeParsedParams(ALL_PARAMS_TEMPLATE));
  const [paramsJsonText, setParamsJsonText] = useState(() => serializeParamsEditor(normalizeParsedParams(ALL_PARAMS_TEMPLATE)));
  const [jsonError, setJsonError] = useState<string>("");

  const updateParams = (patch: Partial<TrainingParamsForm>) => {
    const next = { ...params, ...patch };
    setParams(next);
    setParamsJsonText(serializeParamsEditor(next));
    setJsonError("");
  };

  const updateTimelapse = (patch: Partial<{ images: string[]; every: number }>) => {
    const next = {
      ...params,
      timelapse: {
        images: params.timelapse?.images ?? [],
        every: params.timelapse?.every ?? 50,
        ...patch
      }
    };
    setParams(next);
    setParamsJsonText(serializeParamsEditor(next));
    setJsonError("");
  };

  const applyJsonText = (): TrainingParamsForm | null => {
    try {
      const parsed = normalizeParsedParams(JSON.parse(paramsJsonText));
      setParams(parsed);
      setParamsJsonText(serializeParamsEditor(parsed));
      setJsonError("");
      return parsed;
    } catch (error) {
      setJsonError((error as Error).message);
      return null;
    }
  };

  const timelapseImageCount = params.timelapse?.images?.length ?? 0;
  const timelapseEvery = Number(params.timelapse?.every ?? 0);
  const iterations = Number(params.iterations ?? 0);

  const estimate = useMemo(() => {
    if (timelapseImageCount === 0 || timelapseEvery <= 0 || iterations <= 0) {
      return { frames: 0, gb: 0 };
    }
    const frames = Math.ceil(iterations / timelapseEvery) * timelapseImageCount;
    const gb = Number(((frames * 0.4) / 1024).toFixed(2));
    return { frames, gb };
  }, [timelapseImageCount, timelapseEvery, iterations]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>建立訓練任務（完整參數）</CardTitle>
        <CardDescription>包含所有選項，並可從其他任務複製參數。`--headless` 與 `--train` 會強制啟用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Dataset（可選）</Label>
            <select className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">不選擇（手動 dataPath）</option>
              {datasets.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>從既有任務複製參數</Label>
            <select className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm" value={copyFromJobId} onChange={(e) => setCopyFromJobId(e.target.value)}>
              <option value="">選擇任務</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.id} ({job.status})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const source = jobs.find((job) => job.id === copyFromJobId);
                if (!source?.paramsJson) {
                  onMessage("該任務沒有可複製的參數");
                  return;
                }
                try {
                  const parsed = normalizeParsedParams(JSON.parse(source.paramsJson));
                  setParams(parsed);
                  setParamsJsonText(serializeParamsEditor(parsed));
                  setJsonError("");
                  onMessage(`已載入任務 ${source.id} 的參數`);
                } catch (error) {
                  onMessage(`載入失敗: ${(error as Error).message}`);
                }
              }}
            >
              載入參數
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(paramsJsonText);
                onMessage("參數 JSON 已複製到剪貼簿");
              }}
            >
              複製參數 JSON
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>dataPath（常用）</Label>
            <Input
              value={params.dataPath ?? ""}
              onChange={(e) => updateParams({ dataPath: e.target.value || undefined })}
              placeholder="/app/data/datasets/scene"
            />
          </div>
          <div>
            <Label>outputPath（常用）</Label>
            <Input
              value={params.outputPath ?? ""}
              onChange={(e) => updateParams({ outputPath: e.target.value || undefined })}
              placeholder="/app/data/outputs/scene"
            />
          </div>
          <div>
            <Label>configPath（可選）</Label>
            <Input value={params.configPath ?? ""} onChange={(e) => updateParams({ configPath: e.target.value || undefined })} />
          </div>
          <div>
            <Label>iterations</Label>
            <Input type="number" value={params.iterations ?? 30000} onChange={(e) => updateParams({ iterations: Number(e.target.value) })} />
          </div>
          <div>
            <Label>strategy</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
              value={params.strategy ?? "mcmc"}
              onChange={(e) => updateParams({ strategy: e.target.value as "mcmc" | "adc" | "igs+" })}
            >
              <option value="mcmc">mcmc</option>
              <option value="adc">adc</option>
              <option value="igs+">igs+</option>
            </select>
          </div>
          <div>
            <Label>max-cap</Label>
            <Input type="number" value={params.maxCap ?? 500000} onChange={(e) => updateParams({ maxCap: Number(e.target.value) })} />
          </div>
        </div>

        <div className="rounded-lg border bg-slate-50 p-4">
          <h3 className="mb-3 font-semibold">Timelapse（常用）</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Timelapse 影像（逗號分隔）</Label>
              <Input
                value={(params.timelapse?.images ?? []).join(",")}
                onChange={(e) =>
                  updateTimelapse({
                    images: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean)
                  })
                }
                placeholder="IMG_1.JPG,IMG_2.JPG"
              />
            </div>
            <div>
              <Label>間隔步數（--timelapse-every）</Label>
              <Input type="number" value={params.timelapse?.every ?? 50} onChange={(e) => updateTimelapse({ every: Number(e.target.value) })} />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">估算輸出：{estimate.frames} 張，約 {estimate.gb} GB（粗估每張 0.4MB）</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(params.eval)} onChange={(e) => updateParams({ eval: e.target.checked })} /> --eval
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(params.saveEvalImages)} onChange={(e) => updateParams({ saveEvalImages: e.target.checked })} /> --save-eval-images
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(params.gut)} onChange={(e) => updateParams({ gut: e.target.checked })} /> --gut
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(params.undistort)} onChange={(e) => updateParams({ undistort: e.target.checked })} /> --undistort
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>完整參數 JSON（包含所有選項）</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const applied = applyJsonText();
                  if (applied) onMessage("已套用完整參數 JSON");
                }}
              >
                套用 JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const reset = normalizeParsedParams(ALL_PARAMS_TEMPLATE);
                  setParams(reset);
                  setParamsJsonText(serializeParamsEditor(reset));
                  setJsonError("");
                }}
              >
                重設模板
              </Button>
            </div>
          </div>
          <Textarea
            className="min-h-[420px] font-mono text-xs"
            value={paramsJsonText}
            onChange={(e) => {
              setParamsJsonText(e.target.value);
              setJsonError("");
            }}
          />
          {jsonError ? <p className="mt-2 text-sm text-red-600">{jsonError}</p> : null}
        </div>

        <Button
          onClick={async () => {
            const parsed = applyJsonText();
            if (!parsed) return;

            const payload = {
              datasetId: datasetId || undefined,
              params: parsed
            };

            const res = await api.createJob(payload);
            onMessage(`已建立任務 ${res.item.id}`);
            onCreated(res.item.id);
          }}
        >
          建立任務
        </Button>
      </CardContent>
    </Card>
  );
}

function JobsPanel({
  jobs,
  onSelect,
  onRefresh
}: {
  jobs: TrainingJob[];
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>任務佇列</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">{job.id}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
                </TableCell>
                <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Button size="sm" onClick={() => onSelect(job.id)}>
                    查看
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button className="mt-4" variant="outline" onClick={onRefresh}>
          Refresh
        </Button>
      </CardContent>
    </Card>
  );
}

function JobDetailPanel({
  jobId,
  jobs,
  onRefreshJobs
}: {
  jobId: string;
  jobs: TrainingJob[];
  onRefreshJobs: () => void;
}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [latestFrames, setLatestFrames] = useState<TimelapseFrame[]>([]);
  const [cameras, setCameras] = useState<Array<{ cameraName: string; frameCount: number; lastIteration: number }>>([]);
  const [activeCamera, setActiveCamera] = useState<string>("");
  const [cameraFrames, setCameraFrames] = useState<TimelapseFrame[]>([]);
  const [diskText, setDiskText] = useState<string>("");
  const [streamWarn, setStreamWarn] = useState<string>("");

  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobId), [jobs, jobId]);

  useEffect(() => {
    if (!jobId) return;

    let closed = false;
    setLogs([]);
    const source = new EventSource(`/api/jobs/${jobId}/logs/stream`, { withCredentials: true });

    const handleData = (raw: MessageEvent) => {
      const payload = JSON.parse(raw.data) as EventMessage;
      if (payload.type === "log") {
        const lines = ((payload.data as { lines: string[] }).lines ?? []).filter(Boolean);
        if (lines.length > 0) {
          setLogs((prev) => [...prev, ...lines].slice(-1500));
        }
      }
      if (payload.type === "timelapse.frame.created") {
        const frame = payload.data as TimelapseFrame;
        setLatestFrames((prev) => {
          const map = new Map(prev.map((p) => [p.cameraName, p]));
          map.set(frame.cameraName, frame);
          return [...map.values()].sort((a, b) => a.cameraName.localeCompare(b.cameraName));
        });
      }
      if (payload.type === "job.stopped.low_disk") {
        setStreamWarn("磁碟空間低於門檻，任務已自動中止");
      }
    };

    source.addEventListener("log", handleData);
    source.addEventListener("timelapse.frame.created", handleData);
    source.addEventListener("job.stopped.low_disk", handleData);
    source.onerror = () => {
      if (!closed) {
        setStreamWarn("SSE 連線中斷，正在等待重新整理");
      }
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    const refresh = async () => {
      const [latest, cameraRes] = await Promise.all([api.getTimelapseLatest(jobId), api.getTimelapseCameras(jobId)]);
      setLatestFrames(latest.items);
      setCameras(cameraRes.items);
      setDiskText(`free ${latest.disk.freeGb} GB / threshold ${latest.disk.thresholdGb} GB`);

      if (!activeCamera && cameraRes.items.length > 0) {
        setActiveCamera(cameraRes.items[0].cameraName);
      }
    };

    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [jobId, activeCamera]);

  useEffect(() => {
    if (!jobId || !activeCamera) return;

    api.getTimelapseFrames(jobId, activeCamera).then((res) => setCameraFrames(res.items));
  }, [jobId, activeCamera]);

  if (!jobId) {
    return <Card><CardContent className="p-6">請先選擇任務</CardContent></Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>任務狀態</CardTitle>
          <CardDescription className="font-mono text-xs">{jobId}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={selectedJob ? statusBadgeVariant(selectedJob.status) : "secondary"}>{selectedJob?.status ?? "unknown"}</Badge>
            <span className="text-sm text-muted-foreground">{diskText}</span>
          </div>
          {streamWarn ? (
            <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" /> {streamWarn}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                await api.stopJob(jobId);
                onRefreshJobs();
              }}
            >
              <Square className="mr-2 h-4 w-4" /> 停止任務
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.deleteJob(jobId, false);
                onRefreshJobs();
              }}
            >
              刪除任務（保留 Timelapse）
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.deleteJob(jobId, true);
                onRefreshJobs();
              }}
            >
              刪除任務與 Timelapse
            </Button>
            <a href={`/api/jobs/${jobId}/timelapse/download?camera=all`}>
              <Button variant="outline">下載全部 Timelapse</Button>
            </a>
          </div>

          <div>
            <Label>Log</Label>
            <pre className="mt-2 h-64 overflow-auto rounded-md border bg-black p-3 text-xs text-green-300">{logs.join("\n")}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timelapse 監看</CardTitle>
          <CardDescription>最新 frame 與歷史序列</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {latestFrames.map((frame) => (
              <div key={frame.cameraName} className="rounded-md border p-2">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="outline">{frame.cameraName}</Badge>
                  <span className="font-mono text-xs">{frame.iteration}</span>
                </div>
                <img className="h-32 w-full rounded object-cover" src={`/api/jobs/${jobId}/timelapse/frame?path=${encodeURIComponent(frame.filePath)}`} />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Label>Camera</Label>
            <select className="h-10 rounded-md border border-input bg-white px-3 text-sm" value={activeCamera} onChange={(e) => setActiveCamera(e.target.value)}>
              {cameras.map((cam) => (
                <option value={cam.cameraName} key={cam.cameraName}>
                  {cam.cameraName} ({cam.frameCount})
                </option>
              ))}
            </select>
            {activeCamera ? (
              <a href={`/api/jobs/${jobId}/timelapse/download?camera=${encodeURIComponent(activeCamera)}`}>
                <Button variant="outline">下載此 Camera</Button>
              </a>
            ) : null}
          </div>

          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Iteration</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cameraFrames.map((frame) => (
                  <TableRow key={frame.id}>
                    <TableCell className="font-mono">{frame.iteration}</TableCell>
                    <TableCell>{new Date(frame.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <a target="_blank" href={`/api/jobs/${jobId}/timelapse/frame?path=${encodeURIComponent(frame.filePath)}`}>
                        open
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
