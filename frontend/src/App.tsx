import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, ListChecks, LogOut } from "lucide-react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { JobInsight, Notice } from "@/lib/app-types";
import type { DatasetRecord, SystemMetrics, TrainingJob } from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoginView } from "@/features/auth/LoginView";
import { JobsPage } from "@/pages/JobsPage";
import { CreateJobPage } from "@/pages/CreateJobPage";
import { JobDetailPage } from "@/pages/JobDetailPage";

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && /unauthorized/i.test(error.message);
}

function DashboardShell({
  datasets,
  jobs,
  systemMetrics,
  onLogout,
  logoutPending,
}: {
  datasets: DatasetRecord[];
  jobs: TrainingJob[];
  systemMetrics: SystemMetrics | null;
  onLogout: () => Promise<void>;
  logoutPending: boolean;
}) {
  const location = useLocation();
  const onJobsRoute = location.pathname === "/" || location.pathname.startsWith("/jobs");

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const gpu = systemMetrics?.gpu.devices[0] ?? null;
  const vramText =
    gpu?.memoryUsedMiB !== null && gpu?.memoryUsedMiB !== undefined && gpu?.memoryTotalMiB !== null && gpu?.memoryTotalMiB !== undefined
      ? `${(gpu.memoryUsedMiB / 1024).toFixed(1)} / ${(gpu.memoryTotalMiB / 1024).toFixed(1)} GB`
      : "-";

  return (
    <div className="min-h-screen bg-app-base pb-8 text-zinc-100">
      <header className="border-b border-white/10 bg-black/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">LichtFeld-Studio 任務控制台</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link className={buttonVariants({ variant: onJobsRoute ? "default" : "outline" })} to="/jobs">
              <ListChecks className="mr-2 h-4 w-4" /> 任務首頁
            </Link>
            <Link
              className={buttonVariants({ variant: location.pathname === "/create" ? "default" : "outline" })}
              to="/create"
            >
              <ImagePlus className="mr-2 h-4 w-4" /> 建立任務
            </Link>
            <Button variant="outline" onClick={() => void onLogout()} disabled={logoutPending}>
              <LogOut className="mr-2 h-4 w-4" /> {logoutPending ? "登出中..." : "Logout"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-4 max-w-7xl space-y-4 px-4">
        {onJobsRoute ? (
          <section className="panel-grid noise-overlay relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <div className="grid gap-3 md:grid-cols-[1.6fr_1fr]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">overview</p>
                <h2 className="mt-2 max-w-2xl text-2xl font-semibold leading-tight text-zinc-50">訓練控制台</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">即時監看任務進度、排隊狀態與資料集操作。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-6">
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">running</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{runningCount}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">queued</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{queuedCount}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">datasets</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{datasets.length}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">gpu util</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">
                    {gpu?.utilizationGpu ?? "-"}
                    {gpu?.utilizationGpu !== null && gpu?.utilizationGpu !== undefined ? "%" : ""}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">vram</p>
                  <div className="mt-2 text-sm font-semibold text-zinc-50">{vramText}</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {gpu?.memoryUsedPercent !== null && gpu?.memoryUsedPercent !== undefined ? `${gpu.memoryUsedPercent.toFixed(1)}%` : ""}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">memory</p>
                  <div className="mt-2 text-sm font-semibold text-zinc-50">
                    {systemMetrics ? `${systemMetrics.memory.usedGb.toFixed(1)} / ${systemMetrics.memory.totalGb.toFixed(1)} GB` : "-"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">{systemMetrics ? `${systemMetrics.memory.usedPercent.toFixed(1)}%` : ""}</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const setNoticeText = useCallback((next: Notice) => {
    if (next.tone === "success") {
      toast.success(next.text);
      return;
    }
    if (next.tone === "error") {
      toast.error(next.text);
      return;
    }
    toast.message(next.text);
  }, []);

  const guardAuth = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        if (isUnauthorizedError(error)) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
        }
        throw error;
      }
    },
    [queryClient],
  );

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  });

  const authed = meQuery.data?.authenticated === true;

  const datasetsQuery = useQuery({
    queryKey: queryKeys.datasets.all,
    queryFn: () => guardAuth(() => api.listDatasets()),
    enabled: authed,
  });

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: () => guardAuth(() => api.listJobs()),
    enabled: authed,
    refetchInterval: 5_000,
  });

  const systemMetricsQuery = useQuery({
    queryKey: queryKeys.system.metrics,
    queryFn: () => guardAuth(() => api.systemMetrics()),
    enabled: authed,
    refetchInterval: 5_000,
  });

  const jobs = jobsQuery.data?.items ?? [];
  const datasets = datasetsQuery.data?.items ?? [];
  const datasetFolders = datasetsQuery.data?.folders ?? [];
  const systemMetrics = systemMetricsQuery.data ?? null;

  const insightQueries = useQueries({
    queries: jobs.map((job) => ({
      queryKey: queryKeys.jobs.timelapseLatest(job.id),
      queryFn: () => guardAuth(() => api.getTimelapseLatest(job.id)),
      enabled: authed,
      staleTime: 3_000,
      refetchInterval: 5_000,
      retry: 0,
    })),
  });

  const insights = useMemo<Record<string, JobInsight>>(() => {
    return jobs.reduce<Record<string, JobInsight>>((acc, job, index) => {
      const latest = insightQueries[index]?.data?.items ?? [];
      const newest = latest.reduce<{ filePath: string | null; iteration: number | null }>(
        (current, frame) => {
          if (current.iteration === null || frame.iteration > current.iteration) {
            return { filePath: frame.filePath, iteration: frame.iteration };
          }
          return current;
        },
        { filePath: null, iteration: null },
      );
      acc[job.id] = {
        latestFramePath: newest.filePath,
        latestIteration: newest.iteration,
      };
      return acc;
    }, {});
  }, [jobs, insightQueries]);

  const logoutMutation = useMutation({
    mutationFn: () => guardAuth(() => api.logout()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      queryClient.removeQueries({ queryKey: queryKeys.jobs.all });
      queryClient.removeQueries({ queryKey: queryKeys.datasets.all });
      queryClient.removeQueries({ queryKey: queryKeys.system.metrics });
    },
    onError: (error) => {
      setNoticeText({ tone: "error", text: `登出失敗：${(error as Error).message}` });
    },
  });

  const stopJobMutation = useMutation({
    mutationFn: (id: string) => guardAuth(() => api.stopJob(id)),
    onSuccess: async (_result, id) => {
      setNoticeText({ tone: "success", text: `任務 ${id} 已送出停止指令` });
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.timelapseLatest(id) });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: (id: string) => guardAuth(() => api.deleteJob(id, false)),
    onSuccess: async (_result, id) => {
      setNoticeText({ tone: "success", text: `任務 ${id} 已刪除` });
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (datasetsQuery.error) {
      setNoticeText({ tone: "error", text: `讀取資料集失敗：${(datasetsQuery.error as Error).message}` });
    }
  }, [datasetsQuery.error, datasetsQuery.errorUpdatedAt, setNoticeText]);

  useEffect(() => {
    if (jobsQuery.error) {
      setNoticeText({ tone: "error", text: `讀取任務失敗：${(jobsQuery.error as Error).message}` });
    }
  }, [jobsQuery.error, jobsQuery.errorUpdatedAt, setNoticeText]);

  useEffect(() => {
    if (systemMetricsQuery.error) {
      setNoticeText({ tone: "error", text: `讀取系統資訊失敗：${(systemMetricsQuery.error as Error).message}` });
    }
  }, [setNoticeText, systemMetricsQuery.error, systemMetricsQuery.errorUpdatedAt]);

  if (meQuery.isPending) {
    return <div className="p-8 text-zinc-300">Loading...</div>;
  }

  if (!authed) {
    return <LoginView onLogin={() => void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })} />;
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <DashboardShell
              datasets={datasets}
              jobs={jobs}
              systemMetrics={systemMetrics}
              onLogout={async () => {
                await logoutMutation.mutateAsync();
              }}
              logoutPending={logoutMutation.isPending}
            />
          }
        >
          <Route index element={<Navigate to="/jobs" replace />} />
          <Route
            path="jobs"
            element={
              <JobsPage
                jobs={jobs}
                insights={insights}
                nowMs={nowMs}
                onCreate={() => navigate("/create")}
                onRefresh={async () => {
                  await jobsQuery.refetch({ throwOnError: true });
                }}
                onStop={async (id) => {
                  try {
                    await stopJobMutation.mutateAsync(id);
                  } catch (error) {
                    setNoticeText({ tone: "error", text: `停止任務失敗：${(error as Error).message}` });
                  }
                }}
                onDelete={async (id) => {
                  const ok = window.confirm("確定要刪除此任務？\n按「確定」會保留 Timelapse 檔案。");
                  if (!ok) return;
                  try {
                    await deleteJobMutation.mutateAsync(id);
                  } catch (error) {
                    setNoticeText({ tone: "error", text: `刪除失敗：${(error as Error).message}` });
                  }
                }}
                onOpenDetail={(id) => navigate(`/jobs/${id}`)}
              />
            }
          />
          <Route path="jobs/:id" element={<JobDetailPage onNotice={setNoticeText} />} />
          <Route
            path="create"
            element={
              <CreateJobPage
                datasets={datasets}
                datasetFolders={datasetFolders}
                onCancel={() => navigate("/jobs")}
                onDatasetCreated={(dataset) => {
                  void dataset;
                  void queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all });
                }}
                onCreated={async () => {
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: queryKeys.datasets.all }),
                    queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all }),
                  ]);
                  navigate("/jobs");
                }}
                onNotice={setNoticeText}
                onRefreshDatasets={async () => {
                  await datasetsQuery.refetch({ throwOnError: true });
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/jobs" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}

export default App;
