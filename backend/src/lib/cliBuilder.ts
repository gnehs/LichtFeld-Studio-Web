import type { TrainingParamsForm } from "../types/models.js";

function pushFlag(args: string[], flag: string, enabled?: boolean) {
  if (enabled) {
    args.push(flag);
  }
}

function pushValue(args: string[], flag: string, value?: string | number) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  args.push(flag, String(value));
}

function pushList(args: string[], flag: string, values?: string[]) {
  if (!values || values.length === 0) {
    return;
  }
  for (const value of values) {
    if (value.trim().length > 0) {
      args.push(flag, value.trim());
    }
  }
}

export function buildLfsArgs(form: TrainingParamsForm): string[] {
  const args: string[] = [];

  pushValue(args, "--data-path", form.dataPath);
  pushValue(args, "--output-path", form.outputPath);
  pushValue(args, "--config", form.configPath);
  pushValue(args, "--resume", form.resume);
  pushValue(args, "--init", form.init);
  pushValue(args, "--import-cameras", form.importCameras);

  pushValue(args, "--iter", form.iterations);
  pushValue(args, "--strategy", form.strategy);
  pushValue(args, "--sh-degree", form.shDegree);
  pushValue(args, "--sh-degree-interval", form.shDegreeInterval);
  pushValue(args, "--max-cap", form.maxCap);
  pushValue(args, "--min-opacity", form.minOpacity);
  pushValue(args, "--steps-scaler", form.stepsScaler);
  pushValue(args, "--tile-mode", form.tileMode);

  pushFlag(args, "--random", form.random);
  pushValue(args, "--init-num-pts", form.initNumPts);
  pushValue(args, "--init-extent", form.initExtent);

  pushValue(args, "--images", form.images);
  pushValue(args, "--test-every", form.testEvery);
  pushValue(args, "--resize_factor", form.resizeFactor);
  pushValue(args, "--max-width", form.maxWidth);
  pushFlag(args, "--no-cpu-cache", form.noCpuCache);
  pushFlag(args, "--no-fs-cache", form.noFsCache);
  pushFlag(args, "--undistort", form.undistort);

  pushValue(args, "--mask-mode", form.maskMode);
  pushFlag(args, "--invert-masks", form.invertMasks);
  pushFlag(args, "--no-alpha-as-mask", form.noAlphaAsMask);

  pushFlag(args, "--enable-sparsity", form.enableSparsity);
  pushValue(args, "--sparsify-steps", form.sparsifySteps);
  pushValue(args, "--init-rho", form.initRho);
  pushValue(args, "--prune-ratio", form.pruneRatio);

  pushFlag(args, "--enable-mip", form.enableMip);
  pushFlag(args, "--bilateral-grid", form.bilateralGrid);
  pushFlag(args, "--ppisp", form.ppisp);
  pushFlag(args, "--ppisp-controller", form.ppispController);
  pushFlag(args, "--ppisp-freeze", form.ppispFreeze);
  pushValue(args, "--ppisp-sidecar", form.ppispSidecar);
  pushFlag(args, "--bg-modulation", form.bgModulation);
  pushFlag(args, "--gut", form.gut);

  pushFlag(args, "--eval", form.eval);
  pushFlag(args, "--save-eval-images", form.saveEvalImages);
  pushFlag(args, "--save-depth", form.saveDepth);

  const timelapseImages = form.timelapse?.images ?? [];
  const hasTimelapseImages = timelapseImages.length > 0;
  if (hasTimelapseImages) {
    pushList(args, "--timelapse-images", timelapseImages);
  }
  if (hasTimelapseImages && form.timelapse?.every) {
    pushValue(args, "--timelapse-every", form.timelapse.every);
  }

  pushFlag(args, "--no-splash", form.noSplash);
  pushFlag(args, "--no-interop", form.noInterop);
  pushFlag(args, "--debug-python", form.debugPython);
  pushValue(args, "--debug-python-port", form.debugPythonPort);

  pushValue(args, "--log-level", form.logLevel);
  pushFlag(args, "--verbose", form.verbose);
  pushFlag(args, "--quiet", form.quiet);
  pushValue(args, "--log-file", form.logFile);
  pushValue(args, "--log-filter", form.logFilter);

  if (form.pythonScripts?.length) {
    pushList(args, "--python-script", form.pythonScripts);
  }

  if (!args.includes("--headless")) {
    pushFlag(args, "--headless", true);
  }
  if (!args.includes("--train")) {
    pushFlag(args, "--train", true);
  }

  return args;
}
