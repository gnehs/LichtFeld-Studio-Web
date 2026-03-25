export interface DatasetRecord {
  id: string;
  name: string;
  type: "upload" | "registered";
  path: string;
  createdAt: string;
}

export interface DatasetFolderEntry {
  name: string;
  path: string;
  datasetId: string | null;
  isRegistered: boolean;
  health: "ready" | "uploading" | "stabilizing" | "invalid";
  reason: string | null;
  imageCount: number | null;
  hasMasks: boolean;
  hasAlphaImages: boolean;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "stopped" | "stopped_low_disk";

export interface TimelapseConfig {
  images: string[];
  every: number;
}

export interface TrainingParamsForm {
  dataPath?: string;
  outputPath?: string;
  configPath?: string;
  configJson?: string;
  resume?: string;
  init?: string;
  importCameras?: string;
  iterations?: number;
  strategy?: "mcmc" | "adc" | "igs+";
  shDegree?: number;
  shDegreeInterval?: number;
  maxCap?: number;
  minOpacity?: number;
  stepsScaler?: number;
  tileMode?: 1 | 2 | 4;
  random?: boolean;
  initNumPts?: number;
  initExtent?: number;
  images?: string;
  testEvery?: number;
  resizeFactor?: "auto" | 1 | 2 | 4 | 8;
  maxWidth?: number;
  noCpuCache?: boolean;
  noFsCache?: boolean;
  undistort?: boolean;
  maskMode?: "none" | "segment" | "ignore" | "alpha_consistent";
  invertMasks?: boolean;
  noAlphaAsMask?: boolean;
  enableSparsity?: boolean;
  sparsifySteps?: number;
  initRho?: number;
  pruneRatio?: number;
  enableMip?: boolean;
  bilateralGrid?: boolean;
  ppisp?: boolean;
  ppispController?: boolean;
  ppispFreeze?: boolean;
  ppispSidecar?: string;
  bgModulation?: boolean;
  gut?: boolean;
  eval?: boolean;
  saveEvalImages?: boolean;
  saveDepth?: boolean;
  headless?: boolean;
  train?: boolean;
  noSplash?: boolean;
  noInterop?: boolean;
  debugPython?: boolean;
  debugPythonPort?: number;
  logLevel?: string;
  verbose?: boolean;
  quiet?: boolean;
  logFile?: string;
  logFilter?: string;
  pythonScripts?: string[];
  timelapse?: TimelapseConfig;
}

export interface TrainingJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  outputPath: string;
  stopReason: string | null;
  paramsJson?: string;
}

export interface TimelapseFrame {
  id: number;
  jobId: string;
  cameraName: string;
  iteration: number;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DiskGuardStatus {
  freeGb: number;
  thresholdGb: number;
  action: "ok" | "stop";
}

export interface EventMessage {
  type: "log" | "timelapse.frame.created" | "timelapse.scan.completed" | "job.stopped.low_disk" | "job.status";
  jobId: string;
  data: unknown;
  ts: string;
}
