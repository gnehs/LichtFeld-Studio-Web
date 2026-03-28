import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getDatasetPreviewSrc(folder: DatasetFolderEntry | null) {
  if (!folder?.previewImageRelativePath) return null;
  return `/api/datasets/folders/${encodeURIComponent(folder.name)}/preview?path=${encodeURIComponent(folder.previewImageRelativePath)}`;
}

function getFolderMeta(dataset: DatasetRecord, datasetFolders: DatasetFolderEntry[]) {
  return datasetFolders.find((folder) => folder.datasetId === dataset.id) ?? null;
}

export function DatasetsPage({
  datasets,
  datasetFolders,
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
}) {
  return (
    <section className="space-y-4" data-route="datasets">
      <div className="glass-panel rounded-2xl border-0 p-6">
        <h2 className="text-2xl font-semibold text-zinc-50">資料集列表</h2>
        <p className="mt-2 text-sm text-zinc-400">
          檢視資料集基本資訊，並進入編輯器查看 images、masks、改名與刪除。
        </p>
      </div>

      {datasets.length === 0 ? (
        <div className="glass-panel rounded-2xl border-0 p-6 text-sm text-zinc-400">
          目前沒有資料集。
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {datasets.map((dataset) => {
            const folder = getFolderMeta(dataset, datasetFolders);
            const previewSrc = getDatasetPreviewSrc(folder);
            return (
              <article
                key={dataset.id}
                className="glass-panel flex flex-col gap-4 rounded-2xl border-0 p-5"
              >
                <div className="glass-panel relative aspect-[16/10] overflow-hidden rounded-[1.25rem] border-0 bg-black/30">
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

                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold text-zinc-50">
                      {dataset.name}
                    </h3>
                    <Badge variant="secondary">{dataset.type}</Badge>
                  </div>
                  <p className="text-xs leading-5 text-zinc-400">{dataset.path}</p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
                  <Badge variant="outline">狀態：{folder?.health ?? "unknown"}</Badge>
                  <Badge variant="outline">
                    張數：{folder?.imageCount ?? 0}
                  </Badge>
                  <Badge variant="outline">
                    大小：{formatBytes(folder?.folderSizeBytes ?? 0)}
                  </Badge>
                  <Badge variant="outline">
                    遮罩：
                    {folder?.hasMasks
                      ? "masks"
                      : folder?.hasAlphaImages
                        ? "alpha"
                        : "none"}
                  </Badge>
                </div>

                <div className="mt-auto flex justify-end">
                  <Link
                    to={`/datasets/${dataset.id}/edit`}
                    className={cn(buttonVariants({ variant: "outline" }))}
                  >
                    開啟資料集
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
