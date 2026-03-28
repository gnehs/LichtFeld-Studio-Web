import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
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

export function DatasetsPage({
  datasets,
  datasetFolders,
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
}) {
  return (
    <section className="space-y-4" data-route="datasets">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-50">資料集列表</h2>
        <p className="mt-2 text-sm text-zinc-400">
          在這裡檢視和管理你的資料集。
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
                      ? folder?.imageCount.toLocaleString()
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
      )}
    </section>
  );
}
