export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
  },
  datasets: {
    all: ["datasets"] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    detail: (id: string) => ["jobs", id] as const,
    timelapseLatest: (id: string) => ["jobs", id, "timelapse", "latest"] as const,
    timelapseOverview: (id: string) => ["jobs", id, "timelapse", "overview"] as const,
    timelapseFrames: (id: string, camera: string) => ["jobs", id, "timelapse", "frames", camera] as const,
  },
  system: {
    metrics: ["system", "metrics"] as const,
  },
};
