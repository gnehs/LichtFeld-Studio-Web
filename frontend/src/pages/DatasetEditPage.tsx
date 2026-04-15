import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ImageIcon, Layers3, Trash2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { DatasetDetail, DatasetFileEntry } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

type PreviewMode = "raw" | "mask" | "overlay";
const DATASET_FILE_LIST_INITIAL_HEIGHT = 672;

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

function getMatchedImage(
  entry: DatasetFileEntry | null,
  files: DatasetFileEntry[],
) {
  if (!entry) return files.find((item) => item.kind === "image") ?? null;
  if (entry.kind === "image") return entry;
  const targetStem = getFileStem(entry.relativePath);
  return (
    files.find(
      (item) =>
        item.kind === "image" && getFileStem(item.relativePath) === targetStem,
    ) ?? null
  );
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
    (item) =>
      item.kind === "mask" && getFileStem(item.relativePath) === targetStem,
  );
  if (matchedMask) return matchedMask;
  if (detail?.hasAlphaImages) return entry;
  return null;
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel rounded-xl border-0 bg-white/[0.03] px-4 py-2">
      <p className="text-sm text-white/50 uppercase">{label}</p>
      <p className={cn("text-md font-semibold text-white/75")}>{value}</p>
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
        "glass-panel rounded-xl border-0 px-3 py-1.5 text-sm transition",
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
      <div className="glass-panel w-full max-w-lg rounded-xl border-0 bg-zinc-950/92 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="mt-2 text-xl font-semibold text-zinc-50">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
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
      <div
        className={cn(
          "flex h-full items-center justify-center rounded-lg",
          checkerboardClass,
        )}
      >
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
    <div className={cn("relative h-full overflow-hidden", checkerboardClass)}>
      {mode === "raw" ? (
        <img
          src={rawSrc}
          alt={`${datasetName} raw preview`}
          className="relative z-10 h-full w-full object-contain"
        />
      ) : null}
      {mode === "mask" ? (
        maskSrc ? (
          <div className="relative z-10 flex h-full items-center justify-center">
            <img
              src={maskSrc}
              alt={`${datasetName} css mask preview`}
              className="h-full w-full object-contain"
            />
          </div>
        ) : (
          <div className="relative z-10 flex h-full items-center justify-center p-6 text-sm text-zinc-400">
            找不到對應的 mask 可用於 CSS mask 預覽
          </div>
        )
      ) : null}
      {mode === "overlay" ? (
        <div className="relative z-10 h-full w-full">
          <img
            src={rawSrc}
            alt={`${datasetName} raw preview`}
            className="h-full w-full object-contain"
            style={maskStyle}
          />
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
  const fileListRef = useRef<HTMLDivElement | null>(null);

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

  const rawSrc =
    id && selectedImageEntry
      ? getDatasetFileSrc(id, selectedImageEntry.relativePath)
      : null;
  const maskSrc =
    id && selectedMaskEntry
      ? getDatasetFileSrc(id, selectedMaskEntry.relativePath)
      : null;

  const selectedIndex = useMemo(
    () =>
      selectedEntry
        ? files.findIndex(
            (entry) => entry.relativePath === selectedEntry.relativePath,
          )
        : -1,
    [files, selectedEntry],
  );

  const observeFileListRect = useCallback(
    (
      _instance: unknown,
      callback: (rect: { width: number; height: number }) => void,
    ) => {
      const element = fileListRef.current;

      if (!element) {
        callback({ width: 0, height: DATASET_FILE_LIST_INITIAL_HEIGHT });
        return;
      }

      const emitRect = () => {
        const rect = element.getBoundingClientRect();

        callback({
          width: rect.width,
          height: rect.height || DATASET_FILE_LIST_INITIAL_HEIGHT,
        });
      };

      emitRect();

      if (typeof ResizeObserver === "undefined") {
        return;
      }

      const observer = new ResizeObserver(() => {
        emitRect();
      });

      observer.observe(element);

      return () => {
        observer.disconnect();
      };
    },
    [],
  );

  const fileVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => fileListRef.current,
    estimateSize: () => 88,
    getItemKey: (index) => files[index]?.relativePath ?? index,
    overscan: 6,
    observeElementRect: observeFileListRect,
    initialRect: {
      width: 0,
      height: DATASET_FILE_LIST_INITIAL_HEIGHT,
    },
  });

  const virtualFileItems = fileVirtualizer.getVirtualItems();

  useEffect(() => {
    if (selectedIndex < 0) return;
    fileVirtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [fileVirtualizer, selectedIndex]);

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
        queryClient.invalidateQueries({
          queryKey: queryKeys.datasets.detail(id ?? ""),
        }),
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
    return <section className="py-10 text-center">載入中...</section>;
  }

  if (detailQuery.isError) {
    return (
      <section className="py-10 text-center text-red-300">
        讀取資料集失敗：{(detailQuery.error as Error).message}
      </section>
    );
  }

  if (filesQuery.isError) {
    return (
      <section className="py-10 text-center text-red-300">
        讀取檔案列表失敗：{(filesQuery.error as Error).message}
      </section>
    );
  }

  if (!item) {
    return <section className="py-10 text-center">找不到資料集</section>;
  }

  return (
    <section className="space-y-5" data-route="dataset-edit">
      <div className="flex w-full justify-between gap-3">
        <div>
          <Link
            to="/datasets"
            className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
          >
            <ArrowLeft className="size-4" /> 返回資料集列表
          </Link>
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            size="icon"
            onClick={() => setRenameDialogOpen(true)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
              {item.name}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              {item.path}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{item.health}</Badge>
            <Badge variant="outline">{item.type}</Badge>
            <Badge variant="outline">mask: {item.maskSource}</Badge>
            <Badge variant="outline">{files.length} files</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          label="資料夾大小"
          value={formatBytes(item.folderSizeBytes)}
        />
        <InfoCard label="影像張數" value={`${item.imageCount ?? 0}`} />
        <InfoCard label="遮罩來源" value={item.maskSource} />
        <InfoCard label="建立時間" value={formatDate(item.createdAt)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-panel rounded-xl border-0 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-semibold text-zinc-50">圖片檢視器</h3>

            <div className="flex flex-wrap gap-2">
              <PreviewModeButton
                active={mode === "raw"}
                label="原始影像"
                onClick={() => setMode("raw")}
              />
              <PreviewModeButton
                active={mode === "mask"}
                label="遮罩"
                onClick={() => setMode("mask")}
              />
              <PreviewModeButton
                active={mode === "overlay"}
                label="疊圖"
                onClick={() => setMode("overlay")}
              />
            </div>
          </div>

          <div className="relative h-[32rem] overflow-hidden rounded-xl border-0 bg-black/30">
            <PreviewStage
              datasetName={item.name}
              mode={mode}
              rawSrc={rawSrc}
              maskSrc={maskSrc}
            />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs text-white/50">影像來源</p>
              <p className="text-sm text-zinc-200">
                {selectedImageEntry?.relativePath ?? "未配對影像"}
              </p>
            </div>
            <div>
              <p className="text-xs text-white/50">Mask 來源</p>
              <p className="text-sm text-zinc-200">
                {selectedMaskEntry?.relativePath ?? "未配對 mask"}
              </p>
            </div>
            <div>
              <p className="text-xs text-white/50">當前檔案</p>
              <p className="text-sm text-zinc-200">
                {selectedEntry?.relativePath ?? "尚未選擇"}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="glass-panel overflow-hidden rounded-xl border-0">
            <div
              ref={fileListRef}
              className="max-h-168 overflow-auto px-2 py-2 pr-3"
            >
              <div
                className="relative w-full"
                style={{ height: `${fileVirtualizer.getTotalSize()}px` }}
              >
                {virtualFileItems.map((virtualItem) => {
                  const entry = files[virtualItem.index];
                  if (!entry) return null;

                  const isActive =
                    entry.relativePath === selectedEntry?.relativePath;
                  const thumbSrc = id
                    ? getDatasetFileSrc(id, entry.relativePath)
                    : null;

                  return (
                    <div
                      key={virtualItem.key}
                      className="absolute top-0 left-0 w-full pb-2"
                      style={{
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPath(entry.relativePath)}
                        className={cn(
                          "glass-panel grid w-full grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border-0 p-1 text-left transition",
                          isActive
                            ? "bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]"
                            : "bg-white/[0.02] hover:bg-white/[0.06]",
                        )}
                      >
                        <div className="glass-panel relative flex h-16 items-center justify-center overflow-hidden rounded-xl border-0 bg-black/30">
                          {thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={`${entry.relativePath} thumbnail`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Layers3 className="size-4 text-zinc-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-zinc-500">
                              {entry.kind}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {formatBytes(entry.sizeBytes)}
                            </span>
                          </div>
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {entry.relativePath}
                          </p>
                          <p className="text-xs text-zinc-500">
                            stem: {getFileStem(entry.relativePath)}
                          </p>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() =>
                void renameMutation.mutateAsync(renameValue.trim())
              }
              disabled={renameMutation.isPending || !renameValue.trim()}
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
          <p className="text-sm text-zinc-300">
            輸入完整名稱後才會刪除：
            <span className="font-semibold text-zinc-100">{item.name}</span>
          </p>
          <div className="space-y-2">
            <Label>確認名稱</Label>
            <Input
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              placeholder={item.name}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
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
