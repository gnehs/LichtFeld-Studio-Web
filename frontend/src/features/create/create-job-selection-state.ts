export function getCreateJobBlockingReason({
  selectedDatasetId,
}: {
  selectedDatasetId: string;
}): string | null {
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
  const blockingReason = getCreateJobBlockingReason({ selectedDatasetId });

  return {
    activeDatasetId: selectedDatasetId,
    activeDatasetLabel: selectedDatasetName || "未選擇",
    canSubmit: !blockingReason && !submitting,
    blockingReason,
    submitting,
  };
}
