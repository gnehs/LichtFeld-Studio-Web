import { useLocation } from "react-router-dom";
import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import type { Notice } from "@/lib/app-types";
import type { DatasetFolderEntry, DatasetRecord, TrainingJob, TrainingParamsForm } from "@/lib/types";
import type { CreateJobStrategyDefaults } from "@/features/create/create-job-defaults";

function paramsToWizardValues(params: TrainingParamsForm): Partial<CreateJobStrategyDefaults & { advancedJson: string }> {
  return {
    ...(params.iterations !== undefined && { iterations: params.iterations }),
    ...(params.strategy !== undefined && { strategy: params.strategy }),
    ...(params.shDegree !== undefined && { shDegree: params.shDegree }),
    ...(params.shDegreeInterval !== undefined && { shDegreeInterval: params.shDegreeInterval }),
    ...(params.maxCap !== undefined && { maxCap: params.maxCap }),
    ...(params.minOpacity !== undefined && { minOpacity: params.minOpacity }),
    ...(params.stepsScaler !== undefined && { stepsScaler: params.stepsScaler }),
    ...(params.tileMode !== undefined && { tileMode: params.tileMode }),
    ...(params.random !== undefined && { random: params.random }),
    ...(params.initNumPts !== undefined && { initNumPts: params.initNumPts }),
    ...(params.initExtent !== undefined && { initExtent: params.initExtent }),
    ...(params.images !== undefined && { images: params.images }),
    ...(params.testEvery !== undefined && { testEvery: params.testEvery }),
    ...(params.resizeFactor !== undefined && { resizeFactor: params.resizeFactor }),
    ...(params.maxWidth !== undefined && { maxWidth: params.maxWidth }),
    ...(params.noCpuCache !== undefined && { noCpuCache: params.noCpuCache }),
    ...(params.noFsCache !== undefined && { noFsCache: params.noFsCache }),
    ...(params.eval !== undefined && { eval: params.eval }),
    ...(params.saveEvalImages !== undefined && { saveEvalImages: params.saveEvalImages }),
    ...(params.saveDepth !== undefined && { saveDepth: params.saveDepth }),
    ...(params.gut !== undefined && { gut: params.gut }),
    ...(params.undistort !== undefined && { undistort: params.undistort }),
    ...(params.maskMode !== undefined && { maskMode: params.maskMode }),
    ...(params.invertMasks !== undefined && { invertMasks: params.invertMasks }),
    ...(params.noAlphaAsMask !== undefined && { noAlphaAsMask: params.noAlphaAsMask }),
    ...(params.enableSparsity !== undefined && { enableSparsity: params.enableSparsity }),
    ...(params.sparsifySteps !== undefined && { sparsifySteps: params.sparsifySteps }),
    ...(params.initRho !== undefined && { initRho: params.initRho }),
    ...(params.pruneRatio !== undefined && { pruneRatio: params.pruneRatio }),
    ...(params.enableMip !== undefined && { enableMip: params.enableMip }),
    ...(params.bilateralGrid !== undefined && { bilateralGrid: params.bilateralGrid }),
    ...(params.ppisp !== undefined && { ppisp: params.ppisp }),
    ...(params.ppispController !== undefined && { ppispController: params.ppispController }),
    ...(params.ppispFreeze !== undefined && { ppispFreeze: params.ppispFreeze }),
    ...(params.ppispSidecar !== undefined && { ppispSidecar: params.ppispSidecar }),
    ...(params.bgModulation !== undefined && { bgModulation: params.bgModulation }),
  };
}

export function CreateJobPage({
  datasets,
  datasetFolders,
  onCancel,
  onCreated,
  onNotice,
  onRefreshDatasets
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
  onCancel: () => void;
  onCreated: (jobId: string) => Promise<void>;
  onNotice: (notice: Notice) => void;
  onRefreshDatasets: () => Promise<void>;
}) {
  const location = useLocation();
  const prefillJob = (location.state as { prefillJob?: TrainingJob } | null)?.prefillJob;

  let initialDatasetId: string | undefined;
  let initialValues: Partial<CreateJobStrategyDefaults & { advancedJson: string }> | undefined;

  if (prefillJob) {
    initialDatasetId = prefillJob.datasetId ?? undefined;
    if (prefillJob.paramsJson) {
      try {
        const parsed = JSON.parse(prefillJob.paramsJson) as TrainingParamsForm;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          initialValues = paramsToWizardValues(parsed);
        }
      } catch {
        // ignore
      }
    }
  }

  return (
    <section data-route="create">
      <CreateJobWizard
        datasets={datasets}
        datasetFolders={datasetFolders}
        onCancel={onCancel}
        onCreated={onCreated}
        onNotice={onNotice}
        onRefreshDatasets={onRefreshDatasets}
        initialDatasetId={initialDatasetId}
        initialValues={initialValues}
      />
    </section>
  );
}
