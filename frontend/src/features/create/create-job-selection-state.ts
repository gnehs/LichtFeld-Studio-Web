export function getCreateJobBlockingReason({
  selectedDatasetId,
  submitting,
}: {
  selectedDatasetId: string;
  submitting: boolean;
}): string | null {
  if (submitting) {
    return "任務建立中";
  }

  if (!selectedDatasetId) {
    return "尚未選擇資料集";
  }

  return null;
}

export function getCreateJobSelectionState({
  selectedDatasetId,
  selectedDatasetName,
  submitting,
}: {
  selectedDatasetId: string;
  selectedDatasetName: string | null;
  submitting: boolean;
}) {
  const blockingReason = getCreateJobBlockingReason({
    selectedDatasetId,
    submitting,
  });

  return {
    activeDatasetId: selectedDatasetId,
    activeDatasetLabel: selectedDatasetName || "未選擇",
    canSubmit: !blockingReason,
    blockingReason,
  };
}
