import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import type { Notice } from "@/lib/app-types";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";

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
  return (
    <section data-route="create">
      <CreateJobWizard
        datasets={datasets}
        datasetFolders={datasetFolders}
        onCancel={onCancel}
        onCreated={onCreated}
        onNotice={onNotice}
        onRefreshDatasets={onRefreshDatasets}
      />
    </section>
  );
}
