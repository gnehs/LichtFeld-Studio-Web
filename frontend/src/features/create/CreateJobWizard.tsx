import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { RefreshCw, Sparkles, UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Notice } from "@/lib/app-types";

import { CircleIndicator } from "@/components/CircleIndicator";
import type {
  DatasetFolderEntry,
  DatasetRecord,
  TrainingParamsForm,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  applyVisibleStrategyDefaults,
  getStrategyDefaults,
  shouldShowMaskSettings,
  UPSTREAM_MASK_FOLDERS,
  type CreateJobStrategyDefaults,
} from "./create-job-defaults";
import {
  calculateUploadSpeed,
  formatBytesPerSecond,
  formatUploadPhase,
  isDraggedFileZip,
  mergeUploadDraft,
  normalizeUploadProgress,
  shouldAllowStepTwoWhileUploading,
  shouldAutoStartUpload,
  type PendingUploadDraft,
} from "@/upload-state";
import {
  formatDatasetFolderLabel,
  formatDatasetFolderMeta,
  getDatasetSelectItems,
} from "./create-job-dataset-select";
import {
  CREATE_JOB_SOURCE_MODE_BUTTONS,
  getCreateJobSourceModeState,
  type CreateJobSourceMode,
} from "./create-job-source-mode";

function SourceModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      className="min-w-[160px] flex-1"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

interface CreateWizardValues extends CreateJobStrategyDefaults {
  advancedJson: string;
}

function parseStringList(value: string): string[] | undefined {
  const items = value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const EMPTY_UPLOAD_DRAFT: PendingUploadDraft = {
  status: "idle",
  file: null,
  name: "",
  progress: 0,
  datasetId: null,
  error: null,
  uploadedBytes: 0,
  totalBytes: 0,
  startedAt: null,
};

function ProgressBar({ progress }: { progress: number | null }) {
  const width =
    progress === null
      ? 15
      : Math.round(normalizeUploadProgress(progress) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full border border-white/8 bg-white/[0.05]">
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,rgba(103,232,249,0.95),rgba(45,212,191,0.92),rgba(255,255,255,0.85))] shadow-[0_0_18px_rgba(103,232,249,0.25)] transition-[width] duration-500"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function DatasetStructureGuide() {
  return (
    <div className="*: text-sm text-zinc-300">
      <p>
        資料集根目錄必須直接包含{" "}
        <code className="rounded bg-black/40 px-1 py-0.5 text-xs">images/</code>{" "}
        與{" "}
        <code className="rounded bg-black/40 px-1 py-0.5 text-xs">sparse/</code>
        。
      </p>
      <pre className="scrollbar-dark mt-3 overflow-x-auto rounded-xl border border-white/8 bg-black/80 p-3 text-xs leading-5 text-zinc-100">{`dataset/
|- images/
|  |- 0001.jpg
|  |- 0002.jpg
|  \- ...
\- sparse/
   \- ...`}</pre>
      <p className="mt-2 text-xs text-zinc-400">
        不要多包一層外層資料夾，例如{" "}
        <code className="rounded bg-black/40 px-1 py-0.5">dataset/images</code>
        。
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-400">
        若需要遮罩，請在資料集根目錄額外放入
        <code className="rounded bg-black/40 px-1 py-0.5">masks/</code>
        資料夾；若
        <code className="rounded bg-black/40 px-1 py-0.5">images/</code>
        內的 PNG 含 alpha 通道，也會被視為可用的遮罩來源。
      </p>
    </div>
  );
}

function SourcePanel({
  title,
  description,
  active,
  actions,
  children,
}: {
  title: string;
  description: string;
  active: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`glass-panel rounded-[1.25rem] border-0 p-4 transition-colors ${active ? "bg-cyan-300/[0.05]" : "bg-black/20"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function UploadDropzone({
  file,
  dragging,
  onPick,
  onFilesDropped,
  onDragState,
}: {
  file: File | null;
  dragging: boolean;
  onPick: () => void;
  onFilesDropped: (files: FileList | null) => void;
  onDragState: (dragging: boolean) => void;
}) {
  return (
    <label
      onDragEnter={(event) => {
        event.preventDefault();
        onDragState(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        onDragState(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragState(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragState(false);
        onFilesDropped(event.dataTransfer.files);
      }}
      className={`block cursor-pointer rounded-[1.1rem] border border-dashed px-4 py-6 transition ${dragging ? "border-cyan-300/40 bg-cyan-300/[0.08]" : "border-white/12 bg-black/25 hover:border-white/24 hover:bg-black/35"}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-100">
            拖移 ZIP 到這裡，或點擊選擇檔案
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            只接受 `.zip` 格式。
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          {file ? (
            `已選擇：${file.name}`
          ) : (
            <Button type="button" variant="outline" onClick={onPick}>
              <UploadCloud className="size-4" /> 選擇 ZIP
            </Button>
          )}
        </div>
      </div>
    </label>
  );
}

function CircularUploadProgress({ progress }: { progress: number }) {
  const normalized = normalizeUploadProgress(progress);
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized);

  return (
    <svg viewBox="0 0 72 72" className="h-14 w-14">
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="4"
      />
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        stroke="rgba(103,232,249,0.95)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="39"
        textAnchor="middle"
        className="fill-zinc-100 text-[11px] font-semibold"
      >
        {Math.round(normalized * 100)}%
      </text>
    </svg>
  );
}

function FixedUploadDock({
  draft,
  nowMs,
}: {
  draft: PendingUploadDraft;
  nowMs: number;
}) {
  if (
    !draft.file ||
    (draft.status !== "uploading" &&
      draft.status !== "uploaded" &&
      draft.status !== "error")
  ) {
    return null;
  }
  if (typeof document === "undefined") return null;

  const progress = draft.status === "uploaded" ? 1 : draft.progress;
  const speed =
    draft.status === "uploaded"
      ? null
      : formatBytesPerSecond(
          calculateUploadSpeed(draft.uploadedBytes, draft.startedAt, nowMs),
        );

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[140] w-[min(calc(100vw-1rem),20rem)] -translate-x-1/2">
      <div
        className={`pointer-events-auto rounded-full border px-3 py-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm ${draft.status === "error" ? "border-red-400/25 bg-red-950/85" : "border-white/10 bg-black/50"}`}
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <CircleIndicator
              progress={progress * 100}
              size={40}
              color="var(--chart-1)"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {draft.file.name}
            </p>
            {draft.status !== "error" ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                {speed ? speed : null}
              </div>
            ) : null}
            {draft.status === "error" ? (
              <p className="text-[11px] text-red-100">
                {draft.error ?? "上傳失敗，請重新選擇 ZIP。"}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UploadFailureDialog({
  open,
  message,
  onClose,
  onRetry,
  onReselect,
}: {
  open: boolean;
  message: string;
  onClose: () => void;
  onRetry: () => void;
  onReselect: () => void;
}) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[1.25rem] border border-white/10 bg-zinc-950 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <h3 className="text-lg font-semibold text-zinc-50">
          上傳失敗，要怎麼處理？
        </h3>
        <p className="mt-3 text-sm leading-6 text-zinc-300">{message}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            先保留
          </Button>
          <Button type="button" variant="outline" onClick={onReselect}>
            重新選擇 ZIP
          </Button>
          <Button type="button" onClick={onRetry}>
            再試一次
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ParameterPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-[1.25rem] border-0 bg-black/22 p-4">
      <div className="border-b border-white/8 pb-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function ParameterMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="glass-panel rounded-[1rem] border-0 bg-black/30 p-4">
      <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
        {label}
      </p>
      <div className="mt-2 text-lg font-semibold text-zinc-100">{value}</div>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function ToggleChip({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-[1rem] border px-3 py-3 text-sm transition ${checked ? "border-cyan-300/30 bg-cyan-300/[0.08] text-zinc-100" : "border-white/10 bg-black/20 text-zinc-300"}`}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-zinc-500">{children}</p>;
}

export function CreateJobWizard({
  datasets,
  datasetFolders,
  onCancel,
  onCreated,
  onDatasetCreated,
  onNotice,
  onRefreshDatasets,
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
  onCancel: () => void;
  onCreated: (jobId: string) => Promise<void>;
  onDatasetCreated: (dataset: DatasetRecord) => void;
  onNotice: (notice: Notice) => void;
  onRefreshDatasets: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [dataSourceMode, setDataSourceMode] =
    useState<CreateJobSourceMode>("existing");
  const [draggingUpload, setDraggingUpload] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [uploadNowMs, setUploadNowMs] = useState(() => Date.now());
  const [uploadErrorDialogOpen, setUploadErrorDialogOpen] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [uploadDraft, setUploadDraft] =
    useState<PendingUploadDraft>(EMPTY_UPLOAD_DRAFT);
  const [form, setForm] = useState<CreateWizardValues>(() => ({
    ...getStrategyDefaults("mcmc"),
    advancedJson: "",
  }));
  const [submitting, setSubmitting] = useState(false);

  const uploadDatasetMutation = useMutation({
    mutationFn: ({
      file,
      onProgress,
      onBytesProgress,
    }: {
      file: File;
      onProgress: (progress: number) => void;
      onBytesProgress: (loaded: number, total: number) => void;
    }) => api.uploadDataset(file, undefined, { onProgress, onBytesProgress }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all });
    },
  });

  const renameDatasetMutation = useMutation({
    mutationFn: ({ id, datasetName }: { id: string; datasetName: string }) =>
      api.renameDataset(id, datasetName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all });
    },
  });

  const createJobMutation = useMutation({
    mutationFn: (payload: { datasetId: string; params: TrainingParamsForm }) =>
      api.createJob(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });

  const uploadFile = uploadDraft.file;
  const uploading = uploadDraft.status === "uploading";
  const uploadedDatasetId = uploadDraft.datasetId ?? "";
  const selectableFolders = useMemo(
    () =>
      datasetFolders.filter(
        (folder) =>
          folder.isRegistered &&
          folder.health === "ready" &&
          Boolean(folder.datasetId),
      ),
    [datasetFolders],
  );
  const datasetSelectItems = useMemo(
    () => getDatasetSelectItems(datasetFolders),
    [datasetFolders],
  );
  const datasetSelectValueMap = useMemo(
    () =>
      new Map(
        datasetFolders.flatMap((folder) =>
          folder.datasetId
            ? [
                [
                  folder.datasetId,
                  {
                    name: folder.name,
                    meta: formatDatasetFolderMeta(folder),
                    label: formatDatasetFolderLabel(folder),
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    [datasetFolders],
  );
  const sourceModeState = useMemo(
    () => getCreateJobSourceModeState(dataSourceMode),
    [dataSourceMode],
  );
  const activeDatasetId =
    dataSourceMode === "existing" ? selectedDatasetId : uploadedDatasetId;
  const selectedDataset = useMemo(
    () => datasets.find((item) => item.id === activeDatasetId),
    [datasets, activeDatasetId],
  );
  const selectedDatasetFolder = useMemo(
    () =>
      datasetFolders.find((folder) => folder.datasetId === activeDatasetId) ??
      null,
    [datasetFolders, activeDatasetId],
  );
  const showMaskSettings = shouldShowMaskSettings(
    selectedDatasetFolder?.hasMasks ?? false,
    selectedDatasetFolder?.hasAlphaImages ?? false,
  );
  const activeDatasetLabel =
    dataSourceMode === "upload"
      ? uploadDraft.name || selectedDataset?.name || "未選擇"
      : selectedDataset?.name || "未選擇";
  const canSubmit =
    Boolean(activeDatasetId) &&
    !(dataSourceMode === "upload" && uploading) &&
    !submitting;
  const blockingReason = !activeDatasetId
    ? "尚未完成資料集選擇或匯入"
    : dataSourceMode === "upload" && uploading
      ? "資料集仍在背景上傳中"
      : null;

  useEffect(() => {
    if (selectableFolders.length === 0) {
      setSelectedDatasetId("");
      return;
    }
    const currentStillValid = selectableFolders.some(
      (folder) => folder.datasetId === selectedDatasetId,
    );
    if (!selectedDatasetId || !currentStillValid) {
      setSelectedDatasetId(selectableFolders[0].datasetId ?? "");
    }
  }, [selectableFolders, selectedDatasetId]);

  useEffect(() => {
    if (showMaskSettings) {
      return;
    }
    setForm((prev) => {
      if (
        prev.maskMode === "none" &&
        !prev.invertMasks &&
        !prev.noAlphaAsMask
      ) {
        return prev;
      }
      return {
        ...prev,
        maskMode: "none",
        invertMasks: false,
        noAlphaAsMask: false,
      };
    });
  }, [showMaskSettings]);

  useEffect(() => {
    const timer = setInterval(() => setUploadNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const updateUploadDraft = (patch: Partial<PendingUploadDraft>) => {
    setUploadDraft((prev) => mergeUploadDraft(prev, patch));
  };

  const clearUploadDraft = () => {
    setUploadDraft(EMPTY_UPLOAD_DRAFT);
    setUploadInputKey((prev) => prev + 1);
  };

  const applyUploadFile = (file: File | null) => {
    setUploadErrorDialogOpen(false);
    if (file && !isDraggedFileZip(file)) {
      onNotice({ tone: "error", text: "只支援上傳 .zip 檔案" });
      return;
    }
    setUploadDraft((prev) => ({
      status: "idle",
      file,
      name: prev.name,
      progress: 0,
      datasetId: null,
      error: null,
      uploadedBytes: 0,
      totalBytes: file?.size ?? 0,
      startedAt: null,
    }));
    setUploadInputKey((prev) => prev + 1);
    if (file) {
      setDataSourceMode("upload");
      setStep(2);
    }
  };

  const uploadZip = async (): Promise<string | null> => {
    if (!uploadFile) {
      return null;
    }

    setUploadErrorDialogOpen(false);
    updateUploadDraft({
      status: "uploading",
      progress: 0,
      error: null,
      uploadedBytes: 0,
      totalBytes: uploadFile.size,
      startedAt: Date.now(),
    });
    try {
      const res = await uploadDatasetMutation.mutateAsync({
        file: uploadFile,
        onProgress: (progress) => {
          setUploadDraft((prev) =>
            mergeUploadDraft(prev, {
              status: "uploading",
              progress: normalizeUploadProgress(progress),
              error: null,
            }),
          );
        },
        onBytesProgress: (loaded, total) => {
          setUploadDraft((prev) =>
            mergeUploadDraft(prev, {
              status: "uploading",
              uploadedBytes: loaded,
              totalBytes: total,
              error: null,
            }),
          );
        },
      });
      setUploadDraft((prev) =>
        mergeUploadDraft(prev, {
          status: "uploaded",
          progress: 1,
          datasetId: res.item.id,
          error: null,
          name: prev.name.trim() || res.item.name,
          uploadedBytes: prev.totalBytes || prev.uploadedBytes,
          totalBytes: prev.totalBytes || prev.uploadedBytes,
        }),
      );
      setUploadErrorDialogOpen(false);
      onDatasetCreated(res.item);
      await onRefreshDatasets().catch(() => undefined);
      onNotice({ tone: "success", text: `資料集 ${res.item.name} 上傳完成` });
      return res.item.id;
    } catch (error) {
      updateUploadDraft({
        status: "error",
        error: `上傳失敗：${(error as Error).message}`,
      });
      setStep(1);
      setDataSourceMode("upload");
      setUploadErrorDialogOpen(true);
      onNotice({
        tone: "error",
        text: `上傳失敗：${(error as Error).message}`,
      });
      return null;
    }
  };

  useEffect(() => {
    if (!shouldAutoStartUpload(uploadDraft)) {
      return;
    }
    void uploadZip();
  }, [uploadDraft]);

  const goStepTwo = async () => {
    if (dataSourceMode === "existing") {
      if (!selectedDatasetId) {
        onNotice({ tone: "error", text: "請先選擇一個 dataset" });
        return;
      }
      setStep(2);
      return;
    }
    if (shouldAllowStepTwoWhileUploading(uploadDraft)) {
      setStep(2);
      return;
    }
    const datasetId = uploadedDatasetId || (await uploadZip());
    if (!datasetId) return;
    setStep(2);
  };

  const updateForm = <K extends keyof CreateWizardValues>(
    key: K,
    value: CreateWizardValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const syncUploadedDatasetName = async () => {
    if (dataSourceMode !== "upload" || !activeDatasetId) return;
    const nextName = uploadDraft.name.trim();
    if (!nextName || nextName === selectedDataset?.name) return;
    const res = await renameDatasetMutation.mutateAsync({
      id: activeDatasetId,
      datasetName: nextName,
    });
    onDatasetCreated(res.item);
    setUploadDraft((prev) =>
      mergeUploadDraft(prev, { datasetId: res.item.id, name: res.item.name }),
    );
  };

  const submit = async () => {
    if (dataSourceMode === "upload" && uploading) {
      onNotice({
        tone: "info",
        text: "資料集仍在背景上傳中，請等上傳完成後再建立任務。",
      });
      return;
    }
    if (!activeDatasetId) {
      onNotice({ tone: "error", text: "請先完成資料集步驟" });
      setStep(1);
      return;
    }

    let advanced: Partial<TrainingParamsForm> = {};
    if (form.advancedJson.trim()) {
      try {
        const parsed = JSON.parse(form.advancedJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("進階參數必須是 JSON 物件");
        advanced = parsed as Partial<TrainingParamsForm>;
      } catch (error) {
        onNotice({
          tone: "error",
          text: `進階參數 JSON 格式錯誤：${(error as Error).message}`,
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      await syncUploadedDatasetName();
      const payloadParams: TrainingParamsForm = {
        ...advanced,
        iterations: form.iterations,
        strategy: form.strategy,
        shDegree: form.shDegree,
        shDegreeInterval: form.shDegreeInterval,
        maxCap: form.maxCap,
        minOpacity: form.minOpacity,
        stepsScaler: form.stepsScaler,
        tileMode: form.tileMode,
        random: form.random,
        initNumPts: form.initNumPts || undefined,
        initExtent: form.initExtent || undefined,
        images: form.images.trim() || undefined,
        testEvery: form.testEvery,
        resizeFactor: form.resizeFactor,
        maxWidth: form.maxWidth || undefined,
        noCpuCache: form.noCpuCache,
        noFsCache: form.noFsCache,
        eval: form.eval,
        saveEvalImages: form.saveEvalImages,
        saveDepth: form.saveDepth,
        gut: form.gut,
        undistort: form.undistort,
        maskMode: showMaskSettings ? form.maskMode : undefined,
        invertMasks: showMaskSettings ? form.invertMasks : undefined,
        noAlphaAsMask: showMaskSettings ? form.noAlphaAsMask : undefined,
        enableSparsity: form.enableSparsity,
        sparsifySteps: form.sparsifySteps || undefined,
        initRho: form.initRho || undefined,
        pruneRatio: form.pruneRatio || undefined,
        enableMip: form.enableMip,
        bilateralGrid: form.bilateralGrid,
        ppisp: form.ppisp,
        ppispController: form.ppispController,
        ppispFreeze: form.ppispFreeze,
        ppispSidecar: form.ppispSidecar.trim() || undefined,
        bgModulation: form.bgModulation,
      };

      delete payloadParams.dataPath;

      const res = await createJobMutation.mutateAsync({
        datasetId: activeDatasetId,
        params: payloadParams,
      });
      onNotice({ tone: "success", text: `任務 ${res.item.id} 建立成功` });
      await onCreated(res.item.id);
    } catch (error) {
      onNotice({
        tone: "error",
        text: `建立任務失敗：${(error as Error).message}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-zinc-50">建立新任務</h2>
        <Button variant="outline" onClick={onCancel}>
          返回任務清單
        </Button>
      </div>

      {step === 1 ? (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SourcePanel
              title="資料集來源"
              description="先用上方按鈕切換既有資料集或上傳 ZIP，再決定這次任務要使用哪個資料來源。"
              active
              actions={
                sourceModeState.showRefreshAction ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void onRefreshDatasets()
                        .then(() =>
                          onNotice({
                            tone: "success",
                            text: "資料集清單已重新整理",
                          }),
                        )
                        .catch((error) =>
                          onNotice({
                            tone: "error",
                            text: `重新整理資料集失敗：${(error as Error).message}`,
                          }),
                        );
                    }}
                  >
                    <RefreshCw className="size-4" /> 重新整理
                  </Button>
                ) : null
              }
            >
              <div className="flex flex-wrap gap-2">
                {CREATE_JOB_SOURCE_MODE_BUTTONS.map((item) => (
                  <SourceModeButton
                    key={item.mode}
                    active={dataSourceMode === item.mode}
                    label={item.label}
                    onClick={() => setDataSourceMode(item.mode)}
                  />
                ))}
              </div>

              {sourceModeState.showExistingDatasetSelect ? (
                <>
                  <div>
                    <Label>選擇資料集</Label>
                    <Select
                      items={datasetSelectItems}
                      value={selectedDatasetId || null}
                      onValueChange={(value) => {
                        setSelectedDatasetId(value ?? "");
                      }}
                    >
                      <SelectTrigger className="mt-2 w-full min-h-12 items-start whitespace-normal py-2 data-[size=default]:h-auto *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:items-start">
                        <SelectValue placeholder="請選擇可用 dataset">
                          {(value) => {
                            if (!value) {
                              return "請選擇可用 dataset";
                            }
                            const selected = datasetSelectValueMap.get(
                              value as string,
                            );
                            if (!selected) {
                              return String(value);
                            }
                            return (
                              <span className="flex min-w-0 flex-col py-0.5 leading-tight">
                                <span className="truncate text-sm text-zinc-100">
                                  {selected.name}
                                </span>
                                <span className="truncate text-xs text-zinc-400">
                                  {selected.meta}
                                </span>
                              </span>
                            );
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>所有資料夾</SelectLabel>
                          {datasetFolders.map((folder) => {
                            const disabled =
                              !folder.isRegistered ||
                              folder.health !== "ready" ||
                              !folder.datasetId;
                            return (
                              <SelectItem
                                key={folder.path}
                                value={
                                  folder.datasetId ?? `folder:${folder.path}`
                                }
                                disabled={disabled}
                              >
                                <div className="flex flex-col gap-0.5 py-0.5">
                                  <span className="text-sm text-zinc-100">
                                    {folder.name}
                                  </span>
                                  <span className="text-xs text-zinc-400">
                                    {formatDatasetFolderMeta(folder)}
                                  </span>
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  {datasetFolders.length === 0 ? (
                    <p className="text-sm text-amber-200">
                      目前沒有偵測到資料夾，請先上傳 ZIP 或確認 DATASETS_DIR。
                    </p>
                  ) : selectableFolders.length === 0 ? (
                    <p className="text-sm text-amber-200">
                      目前沒有可建立任務的
                      dataset，請先排除失敗原因或等待寫入完成。
                    </p>
                  ) : null}
                </>
              ) : null}

              {sourceModeState.showUploadSection ? (
                <>
                  <UploadDropzone
                    file={uploadFile}
                    dragging={draggingUpload}
                    onPick={() => {
                      const input = document.getElementById(
                        "dataset-upload-input",
                      ) as HTMLInputElement | null;
                      input?.click();
                    }}
                    onDragState={setDraggingUpload}
                    onFilesDropped={(files) =>
                      applyUploadFile(files?.[0] ?? null)
                    }
                  />
                  <input
                    key={uploadInputKey}
                    id="dataset-upload-input"
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={(e) =>
                      applyUploadFile(e.target.files?.[0] ?? null)
                    }
                  />
                </>
              ) : null}
            </SourcePanel>

            <SourcePanel
              title="資料集格式"
              description="建立任務前請先確認資料集根目錄結構正確，避免上傳或註冊後才發現格式不符。"
              active={false}
            >
              <DatasetStructureGuide />
            </SourcePanel>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void goStepTwo()}>下一步：參數設定</Button>
          </div>
        </div>
      ) : (
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-xl">訓練參數設定</CardTitle>
            <CardDescription>
              目前資料集：
              <span className="font-medium text-zinc-50">
                {activeDatasetLabel}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-4">
                <ParameterPanel
                  title="資料集與命名"
                  description="ZIP 選取後才在這裡命名，避免把來源選擇與命名綁在一起。"
                >
                  <div>
                    <Label>資料集名稱</Label>
                    <Input
                      className="mt-2"
                      value={uploadDraft.name}
                      onChange={(e) =>
                        updateUploadDraft({ name: e.target.value })
                      }
                      placeholder="例如：garden-v2"
                      disabled={dataSourceMode !== "upload"}
                    />
                  </div>
                </ParameterPanel>

                <ParameterPanel
                  title="核心訓練參數"
                  description="先決定主要訓練強度與資料讀取策略，維持高頻操作的清楚度。"
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <ParameterMetric
                      label="iterations"
                      value={form.iterations.toLocaleString()}
                      hint="steps"
                    />
                    <ParameterMetric
                      label="max cap"
                      value={form.maxCap.toLocaleString()}
                      hint="memory / density ceiling"
                    />
                    <ParameterMetric
                      label="resize"
                      value={String(form.resizeFactor)}
                      hint="input scale"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="glass-panel rounded-[1rem] border-0 bg-black/30 p-4">
                      <Label>Iterations</Label>
                      <input
                        type="range"
                        min={5000}
                        max={200000}
                        step={1000}
                        value={form.iterations}
                        onChange={(e) =>
                          updateForm("iterations", Number(e.target.value))
                        }
                        className="range-dark mt-3 w-full"
                      />
                    </div>
                    <div className="glass-panel rounded-[1rem] border-0 bg-black/30 p-4">
                      <Label>Max Cap</Label>
                      <input
                        type="range"
                        min={100000}
                        max={10000000}
                        step={50000}
                        value={form.maxCap}
                        onChange={(e) =>
                          updateForm("maxCap", Number(e.target.value))
                        }
                        className="range-dark mt-3 w-full"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label>SH Degree</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step={1}
                        value={form.shDegree}
                        onChange={(e) =>
                          updateForm("shDegree", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        球諧函數階數，控制外觀表達能力；值越高，顏色/光照表現越細，但成本也越高。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>SH Degree Interval</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step={100}
                        value={form.shDegreeInterval}
                        onChange={(e) =>
                          updateForm(
                            "shDegreeInterval",
                            Number(e.target.value || 0),
                          )
                        }
                      />
                      <FieldHint>
                        MCMC 會依間隔逐步提升 SH
                        階數；數值越小，越早增加外觀複雜度。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Min Opacity</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step="0.001"
                        value={form.minOpacity}
                        onChange={(e) =>
                          updateForm("minOpacity", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        不透明度下限，用來抑制過淡的高斯；調高可能讓模型更乾淨，但也可能吃掉細節。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Steps Scaler</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step="0.1"
                        value={form.stepsScaler}
                        onChange={(e) =>
                          updateForm("stepsScaler", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        依資料量放大訓練節奏；官方說明是依影像數量自動估算，調大通常代表更長的優化與延後某些階段切換。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Tile Mode</Label>
                      <Select
                        value={String(form.tileMode)}
                        onValueChange={(val) =>
                          updateForm("tileMode", Number(val) as 1 | 2 | 4)
                        }
                      >
                        <SelectTrigger className="mt-2 h-10 w-full rounded-xl bg-black/30 hover:bg-black/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="4">4</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldHint>
                        大圖分塊渲染模式；較大的 tile
                        常有助於穩定處理高解析影像，但也會影響效能與記憶體行為。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Init Num Pts</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step={1000}
                        value={form.initNumPts}
                        onChange={(e) =>
                          updateForm("initNumPts", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        隨機初始化時使用的點數；只有搭配 `--random` 才有意義。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Init Extent</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step="0.1"
                        value={form.initExtent}
                        onChange={(e) =>
                          updateForm("initExtent", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        隨機初始化邊界盒大小；值越大，初始點雲分布範圍越廣。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Images Folder</Label>
                      <Input
                        className="mt-2"
                        value={form.images}
                        onChange={(e) => updateForm("images", e.target.value)}
                        placeholder="例如：images"
                      />
                      <FieldHint>
                        官方 CLI 的 `--images` 是影像子資料夾名稱，預設為
                        `images`，不是檔名萬用字元。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Test Every</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step={10}
                        value={form.testEvery}
                        onChange={(e) =>
                          updateForm("testEvery", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        每隔多少 iteration
                        做一次測試/評估；設太小會增加額外開銷。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Max Width</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step={64}
                        value={form.maxWidth}
                        onChange={(e) =>
                          updateForm("maxWidth", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        限制輸入影像最大寬度（像素）；可用來降低顯存與加快訓練。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Strategy</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(["mcmc", "adc", "igs+", "lfs"] as const).map(
                          (strategy) => (
                            <Button
                              key={strategy}
                              variant={
                                form.strategy === strategy
                                  ? "default"
                                  : "outline"
                              }
                              onClick={() =>
                                setForm((prev) =>
                                  applyVisibleStrategyDefaults(prev, strategy),
                                )
                              }
                              type="button"
                            >
                              {strategy}
                            </Button>
                          ),
                        )}
                      </div>
                      <FieldHint>
                        訓練/密度化策略；`mcmc` 與 `lfs` 通常較通用，`gut` 與
                        `adc` / `igs+` 可能存在相容性限制。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Resize Factor</Label>
                      <Select
                        value={String(form.resizeFactor)}
                        onValueChange={(val) =>
                          updateForm(
                            "resizeFactor",
                            val === "auto" ? "auto" : (Number(val) as 1 | 2 | 4 | 8),
                          )
                        }
                      >
                        <SelectTrigger className="mt-2 h-10 w-full rounded-xl bg-black/30 hover:bg-black/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">auto</SelectItem>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">1/2</SelectItem>
                          <SelectItem value="4">1/4</SelectItem>
                          <SelectItem value="8">1/8</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldHint>
                        先對訓練影像降採樣；分母越大，解析度越低，速度越快但細節可能減少。
                      </FieldHint>
                    </div>
                  </div>
                </ParameterPanel>

                <ParameterPanel
                  title="資料處理與進階訓練"
                  description="整理遮罩、稀疏化、MIP、PPISP 與背景調變相關選項。"
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    {showMaskSettings ? (
                      <div>
                        <Label>Mask Mode</Label>
                        <Select
                          value={form.maskMode}
                          onValueChange={(val) =>
                            updateForm("maskMode", val as CreateWizardValues["maskMode"])
                          }
                        >
                          <SelectTrigger className="mt-2 h-10 w-full rounded-xl bg-black/30 hover:bg-black/10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">none</SelectItem>
                            <SelectItem value="segment">segment</SelectItem>
                            <SelectItem value="ignore">ignore</SelectItem>
                            <SelectItem value="alpha_consistent">alpha_consistent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FieldHint>
                          決定如何使用注意力遮罩，例如分割、忽略背景或維持 alpha
                          一致性。
                        </FieldHint>
                      </div>
                    ) : (
                      <div className="rounded-[1rem] border border-dashed border-white/10 bg-black/20 p-4 md:col-span-2">
                        <p className="text-sm text-zinc-200">
                          目前 dataset 未偵測到可自動讀取的 masks
                          資料夾，因此隱藏 mask 相關設定。
                        </p>
                        <FieldHint>
                          參考 upstream，自動搜尋的資料夾名稱包含{" "}
                          {UPSTREAM_MASK_FOLDERS.join(" / ")}；若影像本身帶有
                          RGBA alpha，也會自動作為遮罩來源。
                        </FieldHint>
                      </div>
                    )}
                    <div>
                      <Label>Sparsify Steps</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step={100}
                        value={form.sparsifySteps}
                        onChange={(e) =>
                          updateForm(
                            "sparsifySteps",
                            Number(e.target.value || 0),
                          )
                        }
                      />
                      <FieldHint>
                        啟用 sparsity
                        後的剪枝/稀疏化節奏；通常數值越小，壓縮動作越頻繁。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Init Rho</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        step="0.1"
                        value={form.initRho}
                        onChange={(e) =>
                          updateForm("initRho", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        稀疏化初始化強度參數；屬於進階壓縮調整，建議有實驗需求時再改。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>Prune Ratio</Label>
                      <Input
                        className="mt-2"
                        type="number"
                        min={0}
                        max={1}
                        step="0.01"
                        value={form.pruneRatio}
                        onChange={(e) =>
                          updateForm("pruneRatio", Number(e.target.value || 0))
                        }
                      />
                      <FieldHint>
                        每輪稀疏化要裁掉的比例；過高可能快速壓縮，但也可能犧牲品質。
                      </FieldHint>
                    </div>
                    <div>
                      <Label>PPISP Sidecar</Label>
                      <Input
                        className="mt-2"
                        value={form.ppispSidecar}
                        onChange={(e) =>
                          updateForm("ppispSidecar", e.target.value)
                        }
                        placeholder="例如：/data/ppisp/sidecar.json"
                      />
                      <FieldHint>
                        PPISP 外觀模型 sidecar
                        路徑；這是少數仍需要外部來源的進階欄位。
                      </FieldHint>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ToggleChip
                      checked={form.random}
                      label="--random"
                      onChange={(checked) => updateForm("random", checked)}
                    />
                    <ToggleChip
                      checked={form.noCpuCache}
                      label="--no-cpu-cache"
                      onChange={(checked) => updateForm("noCpuCache", checked)}
                    />
                    <ToggleChip
                      checked={form.noFsCache}
                      label="--no-fs-cache"
                      onChange={(checked) => updateForm("noFsCache", checked)}
                    />
                    {showMaskSettings ? (
                      <ToggleChip
                        checked={form.invertMasks}
                        label="--invert-masks"
                        onChange={(checked) =>
                          updateForm("invertMasks", checked)
                        }
                      />
                    ) : null}
                    {showMaskSettings ? (
                      <ToggleChip
                        checked={form.noAlphaAsMask}
                        label="--no-alpha-as-mask"
                        onChange={(checked) =>
                          updateForm("noAlphaAsMask", checked)
                        }
                      />
                    ) : null}
                    <ToggleChip
                      checked={form.enableSparsity}
                      label="--enable-sparsity"
                      onChange={(checked) =>
                        updateForm("enableSparsity", checked)
                      }
                    />
                    <ToggleChip
                      checked={form.enableMip}
                      label="--enable-mip"
                      onChange={(checked) => updateForm("enableMip", checked)}
                    />
                    <ToggleChip
                      checked={form.bilateralGrid}
                      label="--bilateral-grid"
                      onChange={(checked) =>
                        updateForm("bilateralGrid", checked)
                      }
                    />
                    <ToggleChip
                      checked={form.ppisp}
                      label="--ppisp"
                      onChange={(checked) => updateForm("ppisp", checked)}
                    />
                    <ToggleChip
                      checked={form.ppispController}
                      label="--ppisp-controller"
                      onChange={(checked) =>
                        updateForm("ppispController", checked)
                      }
                    />
                    <ToggleChip
                      checked={form.ppispFreeze}
                      label="--ppisp-freeze"
                      onChange={(checked) => updateForm("ppispFreeze", checked)}
                    />
                    <ToggleChip
                      checked={form.bgModulation}
                      label="--bg-modulation"
                      onChange={(checked) =>
                        updateForm("bgModulation", checked)
                      }
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <FieldHint>
                      `--random`：改用隨機點初始化，而不是依既有重建結果起步。
                    </FieldHint>
                    <FieldHint>
                      `--no-cpu-cache` / `--no-fs-cache`：停用 RAM
                      或磁碟影像快取；通常只在快取造成壓力時才關閉。
                    </FieldHint>
                    {showMaskSettings ? (
                      <FieldHint>
                        `--invert-masks` /
                        `--no-alpha-as-mask`：控制是否反轉遮罩，以及是否停用
                        RGBA alpha 自動當作遮罩來源。
                      </FieldHint>
                    ) : null}
                    <FieldHint>
                      `--enable-sparsity`：開啟模型壓縮/剪枝流程，適合想降低模型大小時使用。
                    </FieldHint>
                    <FieldHint>
                      `--enable-mip`：啟用 mip-splatting
                      抗鋸齒濾波，有助於高頻細節與縮放穩定性。
                    </FieldHint>
                    <FieldHint>
                      `--bilateral-grid`：加入外觀嵌入，處理曝光或顏色不一致資料。
                    </FieldHint>
                    <FieldHint>
                      `--ppisp` /
                      `--ppisp-controller`：啟用每相機外觀校正，以及新視角合成用控制器
                      CNN。
                    </FieldHint>
                    <FieldHint>
                      `--ppisp-freeze`：從既有 sidecar
                      啟動時凍結部分高斯參數，避免外觀模型覆蓋原始幾何。
                    </FieldHint>
                    <FieldHint>
                      `--bg-modulation`：學習獨立背景顏色，對背景變化明顯的資料集較有幫助。
                    </FieldHint>
                  </div>
                </ParameterPanel>

                <ParameterPanel
                  title="選用旗標"
                  description="把常用布林選項整理成同樣尺寸的切換卡。"
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ToggleChip
                      checked={form.eval}
                      label="--eval"
                      onChange={(checked) => updateForm("eval", checked)}
                    />
                    <ToggleChip
                      checked={form.saveEvalImages}
                      label="--save-eval-images"
                      onChange={(checked) =>
                        updateForm("saveEvalImages", checked)
                      }
                    />
                    <ToggleChip
                      checked={form.saveDepth}
                      label="--save-depth"
                      onChange={(checked) => updateForm("saveDepth", checked)}
                    />
                    <ToggleChip
                      checked={form.gut}
                      label="--gut"
                      onChange={(checked) => updateForm("gut", checked)}
                    />
                    <ToggleChip
                      checked={form.undistort}
                      label="--undistort"
                      onChange={(checked) => updateForm("undistort", checked)}
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <FieldHint>
                      `--eval`：訓練時同時跑評估流程，方便觀察品質指標。
                    </FieldHint>
                    <FieldHint>
                      `--save-eval-images` /
                      `--save-depth`：額外輸出評估影像或深度結果，會增加磁碟使用量。
                    </FieldHint>
                    <FieldHint>
                      `--gut`：啟用
                      3DGUT，適合失真相機模型；官方文件指出它不適用於 `adc` /
                      `igs+`。
                    </FieldHint>
                    <FieldHint>
                      `--undistort`：在訓練前先做影像畸變校正，適合需要標準
                      pinhole 訓練流程時使用。
                    </FieldHint>
                  </div>
                </ParameterPanel>

                <ParameterPanel
                  title="進階 JSON 覆寫"
                  description="僅在需要超出預設面板的參數時使用。"
                >
                  <div>
                    <Label>進階參數 JSON（可選）</Label>
                    <Textarea
                      className="mt-2 min-h-[160px] font-mono text-xs"
                      placeholder='{"testEvery": 500, "enableMip": true}'
                      value={form.advancedJson}
                      onChange={(e) =>
                        updateForm("advancedJson", e.target.value)
                      }
                    />
                  </div>
                </ParameterPanel>
              </div>

              <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                <ParameterPanel
                  title="建立任務摘要"
                  description="送出前快速確認資料來源、策略與阻塞原因。"
                >
                  <div className="space-y-3 text-sm text-zinc-300">
                    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                      <span className="text-zinc-500">dataset</span>
                      <span className="max-w-[60%] truncate text-right text-zinc-100">
                        {activeDatasetLabel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                      <span className="text-zinc-500">strategy</span>
                      <span className="text-zinc-100">{form.strategy}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                      <span className="text-zinc-500">iterations</span>
                      <span className="text-zinc-100">
                        {form.iterations.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                      <span className="text-zinc-500">mip / sparsity</span>
                      <span className="text-zinc-100">
                        {`${form.enableMip ? "mip on" : "mip off"} / ${form.enableSparsity ? "sparsity on" : "sparsity off"}`}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`rounded-[1rem] border px-3 py-3 text-sm ${blockingReason ? "border-amber-400/20 bg-amber-400/10 text-amber-100" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"}`}
                  >
                    {blockingReason
                      ? `目前無法建立：${blockingReason}`
                      : "條件已齊備，可以建立任務。"}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" onClick={() => setStep(1)}>
                      返回 Step 1
                    </Button>
                    <Button onClick={() => void submit()} disabled={!canSubmit}>
                      {submitting ? "建立中..." : "建立任務"}
                    </Button>
                  </div>
                </ParameterPanel>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <FixedUploadDock draft={uploadDraft} nowMs={uploadNowMs} />
      <UploadFailureDialog
        open={uploadErrorDialogOpen}
        message={uploadDraft.error ?? "上傳失敗，請確認 ZIP 內容與資料夾結構。"}
        onClose={() => setUploadErrorDialogOpen(false)}
        onRetry={() => {
          setUploadErrorDialogOpen(false);
          setStep(2);
          void uploadZip();
        }}
        onReselect={() => {
          setUploadErrorDialogOpen(false);
          clearUploadDraft();
          setStep(1);
          setDataSourceMode("upload");
        }}
      />
    </div>
  );
}
