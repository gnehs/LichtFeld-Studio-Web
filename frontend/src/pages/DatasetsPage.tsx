import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, RefreshCw, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { Notice } from "@/lib/app-types";
import { queryKeys } from "@/lib/query-keys";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";
import {
  calculateUploadSpeed,
  formatBytesPerSecond,
  formatUploadPhase,
  isDraggedFileZip,
  mergeUploadDraft,
  normalizeUploadProgress,
  type PendingUploadDraft,
} from "@/upload-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function getDatasetPreviewSrc(folder: DatasetFolderEntry | null) {
  if (!folder?.previewImageRelativePath) return null;
  return `/api/datasets/folders/${encodeURIComponent(folder.name)}/preview?path=${encodeURIComponent(folder.previewImageRelativePath)}`;
}

function getFolderMeta(
  dataset: DatasetRecord,
  datasetFolders: DatasetFolderEntry[],
) {
  return (
    datasetFolders.find((folder) => folder.datasetId === dataset.id) ?? null
  );
}

function getDefaultUploadDatasetName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "";
  const strippedZipExtension = trimmed.replace(/\.zip$/i, "").trim();
  return strippedZipExtension || trimmed;
}

function normalizeUploadDatasetName(rawName: string): string {
  return rawName
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[._\- ]+/, "")
    .replace(/[. ]+$/g, "")
    .trim();
}

function getUploadDatasetConflictName(
  datasetName: string,
  datasetFolders: DatasetFolderEntry[],
): string | null {
  const normalizedTarget = normalizeUploadDatasetName(datasetName);
  if (!normalizedTarget) {
    return null;
  }

  const conflict = datasetFolders.find(
    (folder) => normalizeUploadDatasetName(folder.name) === normalizedTarget,
  );

  return conflict?.name ?? null;
}

function getUploadProgress(draft: PendingUploadDraft): number {
  if (draft.status === "uploaded" || draft.status === "processing") {
    return 1;
  }

  return normalizeUploadProgress(draft.progress);
}

function getUploadTransferredBytes(draft: PendingUploadDraft): number {
  const totalBytes = draft.totalBytes || draft.file?.size || 0;
  if (draft.status === "uploaded" || draft.status === "processing") {
    return totalBytes || draft.uploadedBytes;
  }

  if (!totalBytes) {
    return draft.uploadedBytes;
  }

  return Math.min(draft.uploadedBytes, totalBytes);
}

function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-panel rounded-[1.4rem] border-0 bg-black/24 p-4">
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
      className={cn(
        "block cursor-pointer rounded-[1.2rem] border border-dashed px-4 py-6 transition",
        dragging
          ? "border-cyan-300/40 bg-cyan-300/[0.08]"
          : "border-white/12 bg-black/25 hover:border-white/24 hover:bg-black/35",
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-100">
            拖移 ZIP 到這裡，或點擊選擇檔案
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            只接受 `.zip` 格式，資料集名稱會先帶入 ZIP 檔名。
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

function UploadStatusPanel({
  draft,
  nowMs,
}: {
  draft: PendingUploadDraft;
  nowMs: number;
}) {
  if (!draft.file || draft.status === "idle") {
    return null;
  }

  const progress = getUploadProgress(draft);
  const totalBytes = draft.totalBytes || draft.file.size;
  const uploadedBytes = getUploadTransferredBytes(draft);
  const speed =
    draft.status === "uploading"
      ? formatBytesPerSecond(
          calculateUploadSpeed(draft.uploadedBytes, draft.startedAt, nowMs),
        )
      : null;
  const phaseLabel = formatUploadPhase(draft.status);
  const detailText =
    draft.status === "processing"
      ? "伺服器正在解壓縮與驗證 ZIP，完成後會自動出現在資料集列表。"
      : draft.status === "uploaded"
        ? "資料集已完成上傳與驗證，接著可前往任務頁面建立新任務。"
        : draft.status === "error"
          ? draft.error ?? "上傳失敗，請重新選擇 ZIP。"
          : speed && speed !== "—"
            ? `目前傳輸速度約 ${speed}`
            : "正在建立傳輸連線...";

  return (
    <div
      className={cn(
        "glass-panel rounded-[1.2rem] border-0 p-4",
        draft.status === "error"
          ? "bg-red-950/40"
          : draft.status === "uploaded"
            ? "bg-emerald-500/[0.08]"
            : "bg-black/25",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="shrink-0 self-center sm:self-start">
          <CircularUploadProgress progress={progress} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {draft.file.name}
            </p>
            <span className="rounded-full bg-white/8 px-2 py-1 text-[10px] tracking-[0.18em] text-cyan-100 uppercase">
              {phaseLabel}
            </span>
          </div>
          <div className="mt-3">
            <ProgressBar progress={progress} />
          </div>
          <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
            <div className="rounded-2xl bg-black/25 px-3 py-2">
              <p className="text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
                進度
              </p>
              <p className="mt-1 text-sm text-zinc-100">
                {Math.round(progress * 100)}%
              </p>
            </div>
            <div className="rounded-2xl bg-black/25 px-3 py-2">
              <p className="text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
                已傳輸
              </p>
              <p className="mt-1 text-sm text-zinc-100">
                {`${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}`}
              </p>
            </div>
            <div className="rounded-2xl bg-black/25 px-3 py-2">
              <p className="text-[10px] tracking-[0.18em] text-zinc-500 uppercase">
                狀態
              </p>
              <p className="mt-1 text-sm text-zinc-100">{phaseLabel}</p>
            </div>
          </div>
          <p
            className={cn(
              "mt-3 text-xs leading-5",
              draft.status === "error" ? "text-red-100" : "text-zinc-400",
            )}
          >
            {detailText}
          </p>
        </div>
      </div>
    </div>
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
      draft.status !== "processing" &&
      draft.status !== "uploaded" &&
      draft.status !== "error")
  ) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  const progress = getUploadProgress(draft);
  const totalBytes = draft.totalBytes || draft.file.size;
  const uploadedBytes = getUploadTransferredBytes(draft);
  const speed =
    draft.status === "uploaded"
      ? null
      : formatBytesPerSecond(
          calculateUploadSpeed(draft.uploadedBytes, draft.startedAt, nowMs),
        );
  const phaseLabel = formatUploadPhase(draft.status);
  const bytesLabel = `${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}`;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[140] w-[min(calc(100vw-1rem),24rem)] -translate-x-1/2">
      <div
        className={cn(
          "pointer-events-auto rounded-full border px-3 py-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm",
          draft.status === "error"
            ? "border-red-400/25 bg-red-950/85"
            : "border-white/10 bg-black/50",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <CircularUploadProgress progress={progress} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {draft.file.name}
            </p>
            {draft.status !== "error" ? (
              <p className="text-xs text-zinc-400">{`${phaseLabel} · ${bytesLabel}`}</p>
            ) : null}
            {draft.status === "uploading" && speed && speed !== "—" ? (
              <p className="text-[11px] text-zinc-500">{speed}</p>
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

export function DatasetsPage({
  datasets,
  datasetFolders,
  onNotice,
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
  onNotice?: (notice: Notice) => void;
}) {
  const queryClient = useQueryClient();
  const [draggingUpload, setDraggingUpload] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [uploadNowMs, setUploadNowMs] = useState(() => Date.now());
  const [uploadErrorDialogOpen, setUploadErrorDialogOpen] = useState(false);
  const [uploadDraft, setUploadDraft] =
    useState<PendingUploadDraft>(EMPTY_UPLOAD_DRAFT);

  const notify = onNotice ?? (() => undefined);

  const uploadDatasetMutation = useMutation({
    mutationFn: ({
      file,
      datasetName,
      onProgress,
      onBytesProgress,
      onPhaseChange,
    }: {
      file: File;
      datasetName?: string;
      onProgress: (progress: number) => void;
      onBytesProgress: (loaded: number, total: number) => void;
      onPhaseChange: (
        phase: "preparing" | "uploading" | "processing" | "complete",
      ) => void;
    }) =>
      api.uploadDataset(file, datasetName, {
        onProgress,
        onBytesProgress,
        onPhaseChange,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all });
    },
  });

  const uploadBusy =
    uploadDraft.status === "uploading" || uploadDraft.status === "processing";
  const uploadDatasetConflictName = useMemo(
    () => getUploadDatasetConflictName(uploadDraft.name, datasetFolders),
    [datasetFolders, uploadDraft.name],
  );

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
      notify({ tone: "error", text: "只支援上傳 .zip 檔案" });
      return;
    }
    setUploadDraft({
      status: "idle",
      file,
      name: file ? getDefaultUploadDatasetName(file.name) : "",
      progress: 0,
      datasetId: null,
      error: null,
      uploadedBytes: 0,
      totalBytes: file?.size ?? 0,
      startedAt: null,
    });
    setUploadInputKey((prev) => prev + 1);
  };

  const startUpload = async (): Promise<string | null> => {
    if (!uploadDraft.file) {
      notify({ tone: "error", text: "請先選擇 ZIP 檔案" });
      return null;
    }

    if (!uploadDraft.name.trim()) {
      notify({ tone: "error", text: "請先輸入資料集名稱" });
      return null;
    }

    if (uploadDatasetConflictName) {
      notify({ tone: "error", text: "資料集名稱已存在，請改用其他名稱" });
      return null;
    }

    setUploadErrorDialogOpen(false);
    updateUploadDraft({
      status: "uploading",
      progress: 0,
      error: null,
      uploadedBytes: 0,
      totalBytes: uploadDraft.file.size,
      startedAt: Date.now(),
    });

    try {
      const res = await uploadDatasetMutation.mutateAsync({
        file: uploadDraft.file,
        datasetName: uploadDraft.name.trim(),
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
        onPhaseChange: (phase) => {
          if (phase !== "processing") {
            return;
          }

          setUploadDraft((prev) =>
            mergeUploadDraft(prev, {
              status: "processing",
              progress: 1,
              uploadedBytes:
                prev.totalBytes || prev.file?.size || prev.uploadedBytes,
              totalBytes: prev.totalBytes || prev.file?.size || prev.uploadedBytes,
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
      notify({ tone: "success", text: `資料集 ${res.item.name} 上傳完成` });
      return res.item.id;
    } catch (error) {
      updateUploadDraft({
        status: "error",
        error: `上傳失敗：${(error as Error).message}`,
      });
      setUploadErrorDialogOpen(true);
      notify({
        tone: "error",
        text: `上傳失敗：${(error as Error).message}`,
      });
      return null;
    }
  };

  return (
    <section className="space-y-6" data-route="datasets">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-50">資料集列表</h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            新增資料集已集中到這個頁面管理。上傳 ZIP 時請先確認資料集名稱，預設會帶入 ZIP 檔名，完成後即可在建立任務頁面直接選用。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void queryClient
              .invalidateQueries({ queryKey: queryKeys.datasets.all })
              .then(() =>
                notify({ tone: "success", text: "資料集清單已重新整理" }),
              )
              .catch((error) =>
                notify({
                  tone: "error",
                  text: `重新整理資料集失敗：${(error as Error).message}`,
                }),
              );
          }}
        >
          <RefreshCw className="size-4" /> 重新整理
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <Panel
          title="新增資料集"
          description="在這裡上傳新的 ZIP 資料集；資料集名稱預設為 ZIP 檔名，但送出前仍可調整。"
        >
          <UploadDropzone
            file={uploadDraft.file}
            dragging={draggingUpload}
            onPick={() => {
              const input = document.getElementById(
                "dataset-upload-input",
              ) as HTMLInputElement | null;
              input?.click();
            }}
            onDragState={setDraggingUpload}
            onFilesDropped={(files) => applyUploadFile(files?.[0] ?? null)}
          />
          <input
            key={uploadInputKey}
            id="dataset-upload-input"
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(event) => applyUploadFile(event.target.files?.[0] ?? null)}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <Label>資料集名稱</Label>
              <Input
                className="mt-2"
                value={uploadDraft.name}
                onChange={(event) =>
                  updateUploadDraft({ name: event.target.value })
                }
                placeholder="選擇 ZIP 後會自動帶入檔名"
                disabled={!uploadDraft.file || uploadBusy}
              />
              <p className="mt-2 text-xs leading-5 text-zinc-400">
                這個名稱會作為資料集顯示名稱與資料夾名稱，預設為 ZIP 檔案名稱。
              </p>
              {uploadDatasetConflictName ? (
                <p className="mt-2 text-xs leading-5 text-amber-200">
                  資料集名稱已存在：
                  <code className="ml-1 rounded bg-black/40 px-1 py-0.5">
                    {uploadDatasetConflictName}
                  </code>
                  ，請改用其他名稱。
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => clearUploadDraft()}
                disabled={!uploadDraft.file || uploadBusy}
              >
                重新選擇
              </Button>
              <Button
                type="button"
                onClick={() => void startUpload()}
                disabled={!uploadDraft.file || uploadBusy}
              >
                <FolderPlus className="size-4" /> 開始上傳
              </Button>
            </div>
          </div>

          <UploadStatusPanel draft={uploadDraft} nowMs={uploadNowMs} />
        </Panel>

        <Panel
          title="上傳前確認"
          description="把新增資料集的步驟集中在這裡，讓建立任務頁面只保留資料集選擇與訓練參數設定。"
          actions={
            <Link
              to="/create"
              className={buttonVariants({ variant: "outline" })}
            >
              建立新任務
            </Link>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="glass-panel rounded-2xl border-0 bg-white/[0.03] p-4">
              <p className="text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
                1. ZIP 結構
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                根目錄需直接包含 <code className="rounded bg-black/40 px-1 py-0.5">images/</code> 與 <code className="rounded bg-black/40 px-1 py-0.5">sparse/</code>，不要再多包一層外層資料夾。
              </p>
            </div>
            <div className="glass-panel rounded-2xl border-0 bg-white/[0.03] p-4">
              <p className="text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
                2. 命名規則
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                資料集名稱預設取自 ZIP 檔名，送出前可修改；若與既有資料集重名，系統會先阻擋上傳。
              </p>
            </div>
          </div>

          <pre className="scrollbar-dark overflow-x-auto rounded-2xl border border-white/8 bg-black/80 p-4 text-xs leading-5 text-zinc-100">{`dataset/
|- images/
|  |- 0001.jpg
|  \- ...
\- sparse/
   \- ...`}</pre>

          <div className="rounded-[1.2rem] border border-cyan-300/18 bg-cyan-300/[0.06] p-4 text-sm leading-6 text-cyan-50">
            建立任務頁面現在只負責挑選現有資料集與設定訓練參數；若還沒有資料集，請先在這裡完成上傳。
          </div>
        </Panel>
      </div>

      {datasets.length === 0 ? (
        <div className="glass-panel rounded-2xl border-0 p-6 text-sm text-zinc-400">
          目前沒有資料集。你可以先從上方的「新增資料集」區塊上傳 ZIP。
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">已註冊資料集</h3>
            <p className="mt-1 text-sm text-zinc-400">
              點進資料集卡片可查看預覽、重新命名或刪除。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {datasets.map((dataset) => {
              const folder = getFolderMeta(dataset, datasetFolders);
              const previewSrc = getDatasetPreviewSrc(folder);
              return (
                <Link
                  to={`/datasets/${dataset.id}/edit`}
                  key={dataset.id}
                  className="glass-panel flex flex-col gap-3 rounded-2xl border-0 p-3 transition-colors hover:bg-white/2.5 active:bg-white/5"
                >
                  <div className="glass-panel relative aspect-[16/10] overflow-hidden rounded-xl border-0 bg-black/30">
                    {previewSrc ? (
                      <img
                        src={previewSrc}
                        alt={`${dataset.name} preview`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                        無預覽圖
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.55))]" />
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-zinc-50">
                      {dataset.name}
                    </h3>
                    <p className="text-xs leading-5 text-zinc-400">
                      {dataset.path}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
                    <div>狀態：{folder?.health ?? "unknown"}</div>
                    <div>
                      張數：
                      {folder?.imageCount
                        ? folder.imageCount.toLocaleString()
                        : 0}
                    </div>
                    <div>大小：{formatBytes(folder?.folderSizeBytes ?? 0)}</div>
                    <div>
                      遮罩：
                      {folder?.hasMasks
                        ? "masks"
                        : folder?.hasAlphaImages
                          ? "alpha"
                          : "none"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <FixedUploadDock draft={uploadDraft} nowMs={uploadNowMs} />
      <UploadFailureDialog
        open={uploadErrorDialogOpen}
        message={uploadDraft.error ?? "上傳失敗，請確認 ZIP 內容與資料夾結構。"}
        onClose={() => setUploadErrorDialogOpen(false)}
        onRetry={() => {
          setUploadErrorDialogOpen(false);
          void startUpload();
        }}
        onReselect={() => {
          setUploadErrorDialogOpen(false);
          clearUploadDraft();
        }}
      />
    </section>
  );
}
