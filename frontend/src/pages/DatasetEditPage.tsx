import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderPen, ImageIcon, Layers3, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { DatasetDetail, DatasetFileEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type PreviewMode = "raw" | "mask" | "overlay";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-TW");
}

function getDatasetFileSrc(datasetId: string, relativePath: string) {
  return `/api/datasets/${encodeURIComponent(datasetId)}/file?path=${encodeURIComponent(relativePath)}`;
}

function getFileStem(relativePath: string) {
  const normalized = relativePath.split("/").pop() ?? relativePath;
  return normalized.replace(/\.[^.]+$/, "");
}

function getMatchedImage(entry: DatasetFileEntry | null, files: DatasetFileEntry[]) {
  if (!entry) return files.find((item) => item.kind === "image") ?? null;
  if (entry.kind === "image") return entry;
  const targetStem = getFileStem(entry.relativePath);
  return files.find((item) => item.kind === "image" && getFileStem(item.relativePath) === targetStem) ?? null;
}

function getMatchedMask(
  entry: DatasetFileEntry | null,
  files: DatasetFileEntry[],
  detail: DatasetDetail | null,
) {
  if (!entry) {
    return files.find((item) => item.kind === "mask") ?? null;
  }

  if (entry.kind === "mask") return entry;
  const targetStem = getFileStem(entry.relativePath);
  const matchedMask = files.find(
    (item) => item.kind === "mask" && getFileStem(item.relativePath) === targetStem,
  );
  if (matchedMask) return matchedMask;
  if (detail?.hasAlphaImages) return entry;
  return null;
}

function InfoCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="glass-panel rounded-2xl border-0 bg-white/[0.03] p-4">
      <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className={cn("mt-3 text-lg font-semibold", accent)}>{value}</p>
    </div>
  );
}

function PreviewModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass-panel rounded-full border-0 px-3 py-1.5 text-sm transition",
        active
          ? "bg-cyan-400/20 text-cyan-100"
          : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200",
      )}
    >
      {label}
    </button>
  );
}

function InspectorDialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/72 px-4 backdrop-blur-md">
      <div className="glass-panel w-full max-w-lg rounded-[2rem] border-0 bg-zinc-950/92 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Dataset Action</p>
            <h3 className="mt-2 text-xl font-semibold text-zinc-50">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
            aria-label="close dialog"
          >
            ×
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function PreviewStage({
  datasetName,
  mode,
  rawSrc,
  maskSrc,
}: {
  datasetName: string;
  mode: PreviewMode;
  rawSrc: string | null;
  maskSrc: string | null;
}) {
  const checkerboardClass =
    "bg-[linear-gradient(45deg,rgba(255,255,255,0.05)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,0.05)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,0.05)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,0.05)_75%)] [background-position:0_0,0_12px,12px_-12px,-12px_0] [background-size:24px_24px]";

  if (!rawSrc) {
    return (
      <div className={cn("flex h-full items-center justify-center rounded-[1.75rem]", checkerboardClass)}>
        <p className="text-sm text-zinc-500">這個資料集目前沒有可預覽影像</p>
      </div>
    );
  }

  const maskStyle = maskSrc
      ? {
          maskImage: `url(${maskSrc})`,
          WebkitMaskImage: `url(${maskSrc})`,
          maskMode: "luminance",
          WebkitMaskMode: "luminance",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }
    : undefined;

  return (
    <div className={cn("relative h-full overflow-hidden rounded-[1.75rem]", checkerboardClass)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_55%),radial-gradient(circle_at_bottom,rgba(251,191,36,0.08),transparent_45%)]" />
      {mode === "raw" ? (
        <img
          src={rawSrc}
          alt={`${datasetName} raw preview`}
          className="relative z-10 h-full w-full object-contain p-6"
        />
      ) : null}
      {mode === "mask" ? (
        maskSrc ? (
          <div className="relative z-10 flex h-full items-center justify-center p-6">
            <img
              src={maskSrc}
              alt={`${datasetName} css mask preview`}
              className="h-full w-full object-contain p-6"
            />
          </div>
        ) : (
          <div className="relative z-10 flex h-full items-center justify-center p-6 text-sm text-zinc-400">
            找不到對應的 mask 可用於 CSS mask 預覽
          </div>
        )
      ) : null}
      {mode === "overlay" ? (
        <div className="relative z-10 h-full w-full p-6">
          <img
            src={rawSrc}
            alt={`${datasetName} raw preview`}
            className="h-full w-full object-contain"
          />
          {maskSrc ? (
            <div className="pointer-events-none absolute inset-6">
              <div
                className="h-full w-full bg-[linear-gradient(180deg,rgba(186,230,253,0.76),rgba(34,211,238,0.52),rgba(244,114,182,0.34))] mix-blend-screen"
                style={maskStyle}
                aria-label="overlay mask preview"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DatasetEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renameValue, setRenameValue] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [mode, setMode] = useState<PreviewMode>("mask");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: queryKeys.datasets.detail(id ?? ""),
    queryFn: async () => {
      if (!id) throw new Error("dataset id is required");
      return api.getDataset(id);
    },
    enabled: Boolean(id),
  });

  const filesQuery = useQuery({
    queryKey: queryKeys.datasets.files(id ?? ""),
    queryFn: async () => {
      if (!id) throw new Error("dataset id is required");
      return api.getDatasetFiles(id);
    },
    enabled: Boolean(id),
  });

  const item = detailQuery.data?.item ?? null;
  const files = filesQuery.data?.item.items ?? [];

  const selectedEntry = useMemo(() => {
    if (selectedPath) {
      return files.find((entry) => entry.relativePath === selectedPath) ?? null;
    }
    return files.find((entry) => entry.kind === "image") ?? files[0] ?? null;
  }, [files, selectedPath]);

  const selectedImageEntry = useMemo(
    () => getMatchedImage(selectedEntry, files),
    [files, selectedEntry],
  );
  const selectedMaskEntry = useMemo(
    () => getMatchedMask(selectedEntry, files, item),
    [files, item, selectedEntry],
  );

  const rawSrc = id && selectedImageEntry ? getDatasetFileSrc(id, selectedImageEntry.relativePath) : null;
  const maskSrc = id && selectedMaskEntry ? getDatasetFileSrc(id, selectedMaskEntry.relativePath) : null;

  const renameMutation = useMutation({
    mutationFn: async (nextName: string) => {
      if (!id) throw new Error("dataset id is required");
      return api.renameDataset(id, nextName);
    },
    onSuccess: async () => {
      setRenameValue("");
      setRenameDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets.detail(id ?? "") }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("dataset id is required");
      if (!item) throw new Error("dataset not loaded");
      return api.deleteDataset(id, confirmName);
    },
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all });
      navigate("/datasets");
    },
  });

  if (detailQuery.isLoading || filesQuery.isLoading) {
    return <section className="glass-panel rounded-2xl border-0 p-6">載入中...</section>;
  }

  if (!item) {
    return <section className="glass-panel rounded-2xl border-0 p-6">找不到資料集</section>;
  }

  return (
    <section className="space-y-5" data-route="dataset-edit">
      <div className="glass-panel relative overflow-hidden rounded-[2rem] border-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.1),transparent_28%),rgba(255,255,255,0.02)] p-6">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent,rgba(255,255,255,0.03),transparent)]" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Link
              to="/datasets"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
            >
              <ArrowLeft className="size-4" /> 返回資料集列表
            </Link>
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Dataset Inspector</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">{item.name}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{item.path}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{item.health}</Badge>
              <Badge variant="outline">{item.type}</Badge>
              <Badge variant="outline">mask: {item.maskSource}</Badge>
              <Badge variant="outline">{files.length} files</Badge>
            </div>
          </div>

          <div className="glass-panel flex min-w-[280px] flex-col gap-3 rounded-[1.5rem] border-0 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-zinc-200">
              <Layers3 className="size-4 text-cyan-300" />
              <span className="text-sm font-medium">資料集操作</span>
            </div>
            <Button type="button" onClick={() => setRenameDialogOpen(true)}>
              <FolderPen className="size-4" /> 編輯資料集
            </Button>
            <Button type="button" variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="size-4" /> 刪除資料集
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="資料夾大小" value={formatBytes(item.folderSizeBytes)} accent="text-cyan-100" />
        <InfoCard label="影像張數" value={`${item.imageCount ?? 0}`} accent="text-amber-100" />
        <InfoCard label="遮罩來源" value={item.maskSource} accent="text-fuchsia-100" />
        <InfoCard label="建立時間" value={formatDate(item.createdAt)} accent="text-zinc-100" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-panel rounded-[2rem] border-0 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">預覽模式</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-50">訓練讀取視角檢查</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <PreviewModeButton active={mode === "raw"} label="原始影像" onClick={() => setMode("raw")} />
              <PreviewModeButton active={mode === "mask"} label="CSS Mask" onClick={() => setMode("mask")} />
              <PreviewModeButton active={mode === "overlay"} label="疊圖" onClick={() => setMode("overlay")} />
            </div>
          </div>

          <div className="glass-panel relative h-[32rem] rounded-[2rem] border-0 bg-black/30 p-3">
            <PreviewStage datasetName={item.name} mode={mode} rawSrc={rawSrc} maskSrc={maskSrc} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="glass-panel rounded-2xl border-0 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">影像來源</p>
              <p className="mt-3 text-sm text-zinc-200">{selectedImageEntry?.relativePath ?? "未配對影像"}</p>
            </div>
            <div className="glass-panel rounded-2xl border-0 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Mask 來源</p>
              <p className="mt-3 text-sm text-zinc-200">{selectedMaskEntry?.relativePath ?? "未配對 mask"}</p>
            </div>
            <div className="glass-panel rounded-2xl border-0 bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">當前檔案</p>
              <p className="mt-3 text-sm text-zinc-200">{selectedEntry?.relativePath ?? "尚未選擇"}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="glass-panel rounded-[2rem] border-0 p-5">
            <div className="mb-4 flex items-center gap-2">
              <ImageIcon className="size-4 text-cyan-300" />
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">檔案瀏覽</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-50">Images & Masks</h3>
              </div>
            </div>

            <div className="grid max-h-[42rem] gap-2 overflow-auto pr-1">
              {files.map((entry) => {
                const isActive = entry.relativePath === selectedEntry?.relativePath;
                const thumbSrc = id ? getDatasetFileSrc(id, entry.relativePath) : null;

                return (
                  <button
                    key={entry.relativePath}
                    type="button"
                    onClick={() => setSelectedPath(entry.relativePath)}
                    className={cn(
                      "glass-panel grid grid-cols-[4rem_1fr] gap-3 rounded-[1.4rem] border-0 p-3 text-left transition",
                      isActive
                        ? "bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]"
                        : "bg-white/[0.02] hover:bg-white/[0.06]",
                    )}
                  >
                    <div className="glass-panel relative flex h-16 items-center justify-center overflow-hidden rounded-[1rem] border-0 bg-black/30">
                      {thumbSrc ? (
                        <img src={thumbSrc} alt={`${entry.relativePath} thumbnail`} className="h-full w-full object-cover" />
                      ) : (
                        <Layers3 className="size-4 text-zinc-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={entry.kind === "image" ? "secondary" : "outline"}>{entry.kind}</Badge>
                        <span className="text-xs text-zinc-500">{formatBytes(entry.sizeBytes)}</span>
                      </div>
                      <p className="mt-2 truncate text-sm font-medium text-zinc-100">{entry.relativePath}</p>
                      <p className="mt-1 text-xs text-zinc-500">stem: {getFileStem(entry.relativePath)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass-panel rounded-[2rem] border-0 bg-[linear-gradient(180deg,rgba(127,29,29,0.12),rgba(9,9,11,0.16))] p-5">
            <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Risk Notice</p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              CSS Mask 會顯示原始 mask 圖；若要同時檢查原圖與遮罩套用後的視覺結果，請切到疊圖模式。改名與刪除請使用上方操作按鈕開啟 dialog 進行。
            </p>
          </div>
        </div>
      </div>

      <InspectorDialog
        open={renameDialogOpen}
        title="編輯資料集"
        description="修改後會同步更新資料夾名稱與資料集顯示名稱。"
        onClose={() => setRenameDialogOpen(false)}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>新的資料夾名稱</Label>
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder={item.name}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenameDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void renameMutation.mutateAsync(renameValue || item.name)}
              disabled={renameMutation.isPending}
            >
              {renameMutation.isPending ? "儲存中..." : "套用新的資料夾名稱"}
            </Button>
          </div>
        </div>
      </InspectorDialog>

      <InspectorDialog
        open={deleteDialogOpen}
        title="刪除資料集"
        description="這會移除資料夾與資料庫紀錄。請再次確認名稱後再繼續。"
        onClose={() => setDeleteDialogOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">輸入完整名稱後才會刪除：<span className="font-semibold text-zinc-100">{item.name}</span></p>
          <div className="space-y-2">
            <Label>確認名稱</Label>
            <Input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={item.name} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteMutation.mutateAsync()}
              disabled={confirmName !== item.name || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "刪除中..." : "確認刪除資料集"}
            </Button>
          </div>
        </div>
      </InspectorDialog>
    </section>
  );
}
