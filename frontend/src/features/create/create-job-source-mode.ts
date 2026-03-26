export type CreateJobSourceMode = "existing" | "upload";

export const CREATE_JOB_SOURCE_MODE_BUTTONS = [
  { mode: "existing", label: "既有資料集" },
  { mode: "upload", label: "上傳 ZIP" },
] as const;

export function getCreateJobSourceModeState(mode: CreateJobSourceMode) {
  return {
    showExistingDatasetSelect: mode === "existing",
    showUploadSection: mode === "upload",
    showRefreshAction: mode === "existing",
  };
}
