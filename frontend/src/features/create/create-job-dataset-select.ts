import type { DatasetFolderEntry } from "@/lib/types";

function localizeFolderReason(reason: string | null): string {
  if (!reason) return "未知原因";
  if (reason.includes("Missing sparse/")) return "缺少 sparse/ 目錄";
  if (reason.includes("Missing images/")) return "缺少 images/ 目錄";
  if (reason.includes("upload in progress")) return "上傳尚未完成";
  if (reason.includes("still being written")) return "資料夾仍在寫入中";
  return reason;
}

export function formatDatasetFolderMeta(folder: DatasetFolderEntry): string {
  if (folder.imageCount !== null) {
    return folder.hasMasks || folder.hasAlphaImages
      ? `${folder.imageCount} 張相片 - 包含遮罩`
      : `${folder.imageCount} 張相片`;
  }
  if (folder.health === "uploading") {
    return "上傳中";
  }
  if (folder.health === "stabilizing") {
    return "寫入穩定中";
  }
  return `失敗：${localizeFolderReason(folder.reason)}`;
}

export function formatDatasetFolderLabel(folder: DatasetFolderEntry): string {
  return `${folder.name} - ${formatDatasetFolderMeta(folder)}`;
}

export function getDatasetFolderPreviewSrc(folder: DatasetFolderEntry): string | null {
  if (!folder.previewImageRelativePath) {
    return null;
  }

  return `/api/datasets/folders/${encodeURIComponent(folder.name)}/preview?path=${encodeURIComponent(folder.previewImageRelativePath)}`;
}

export function getDatasetSelectItems(datasetFolders: DatasetFolderEntry[]) {
  return datasetFolders.flatMap((folder) =>
    folder.datasetId
      ? [
          {
            value: folder.datasetId,
            label: formatDatasetFolderLabel(folder),
          },
        ]
      : [],
  );
}
