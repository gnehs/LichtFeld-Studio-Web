import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import type { Notice } from "@/lib/app-types";
import type { DatasetRecord } from "@/lib/types";

export function CreateJobPage({
  datasets,
  onCancel,
  onCreated,
  onDatasetCreated,
  onNotice,
  onRefreshDatasets
}: {
  datasets: DatasetRecord[];
  onCancel: () => void;
  onCreated: (jobId: string) => Promise<void>;
  onDatasetCreated: (dataset: DatasetRecord) => void;
  onNotice: (notice: Notice) => void;
  onRefreshDatasets: () => Promise<void>;
}) {
  return (
    <section data-route="create">
      <CreateJobWizard
        datasets={datasets}
        onCancel={onCancel}
        onCreated={onCreated}
        onDatasetCreated={onDatasetCreated}
        onNotice={onNotice}
        onRefreshDatasets={onRefreshDatasets}
      />
    </section>
  );
}
