import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import type { Notice } from "@/lib/app-types";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";

export function CreateJobPage({
  datasets,
  datasetFolders,
  onCancel,
  onCreated,
  onDatasetCreated,
  onNotice,
  onRefreshDatasets
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
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
        datasetFolders={datasetFolders}
        onCancel={onCancel}
        onCreated={onCreated}
        onDatasetCreated={onDatasetCreated}
        onNotice={onNotice}
        onRefreshDatasets={onRefreshDatasets}
      />
    </section>
  );
}
