import { TaskList } from "@/features/jobs/TaskList";
import type { JobInsight } from "@/lib/app-types";
import type { TrainingJob } from "@/lib/types";

export function JobsPage({
  jobs,
  insights,
  nowMs,
  isLoading,
  onCreate,
  onRefresh,
  onStop,
  onDelete,
  onOpenDetail,
  onRetry,
  onEdit,
}: {
  jobs: TrainingJob[];
  insights: Record<string, JobInsight>;
  nowMs: number;
  isLoading?: boolean;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDetail: (id: string) => void;
  onRetry: (job: TrainingJob) => Promise<void>;
  onEdit: (job: TrainingJob) => void;
}) {
  return (
    <section data-route="jobs">
      <TaskList
        jobs={jobs}
        insights={insights}
        nowMs={nowMs}
        isLoading={isLoading}
        onCreate={onCreate}
        onRefresh={onRefresh}
        onStop={onStop}
        onDelete={onDelete}
        onOpenDetail={onOpenDetail}
        onRetry={onRetry}
        onEdit={onEdit}
      />
    </section>
  );
}
