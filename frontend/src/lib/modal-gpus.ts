export const MODAL_GPU_SKUS = [
  "T4",
  "L4",
  "A10",
  "L40S",
  "A100",
  "A100-40GB",
  "A100-80GB",
  "RTX-PRO-6000",
  "H100",
  "H100!",
  "H200",
  "B200",
  "B200+",
  "B300",
] as const;

export type ModalGpuSku = (typeof MODAL_GPU_SKUS)[number];

// Coarse capability tiers keep retry choices predictable. B300/B200+ are not
// offered here because the current CUDA 12.8 trainer image does not meet the
// CUDA 13.1 requirement documented for B300.
const RETRY_GPU_TIERS: readonly (readonly ModalGpuSku[])[] = [
  ["T4"],
  ["L4", "A10"],
  ["A100", "A100-40GB"],
  ["L40S"],
  ["A100-80GB"],
  ["H100", "H100!"],
  ["RTX-PRO-6000"],
  ["H200"],
  ["B200"],
];

const RETRY_GPU_OPTIONS = RETRY_GPU_TIERS.flat();

export function getModalGpuUpgradeOptions(
  currentGpu: string | undefined,
): ModalGpuSku[] {
  const currentTier = RETRY_GPU_TIERS.findIndex((tier) =>
    tier.includes(currentGpu as ModalGpuSku),
  );
  if (currentTier < 0) return [...RETRY_GPU_OPTIONS];
  return RETRY_GPU_TIERS.slice(currentTier + 1).flat();
}

export function getRecommendedModalGpu(
  currentGpu: string | undefined,
): ModalGpuSku | null {
  return getModalGpuUpgradeOptions(currentGpu)[0] ?? null;
}
