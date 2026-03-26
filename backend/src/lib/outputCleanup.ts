import fs from "node:fs";
import path from "node:path";

function isSubPath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function removePathWithinRoot(targetPath: string, rootPath: string, options?: { recursive?: boolean }): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);

  if (!isSubPath(resolvedTarget, resolvedRoot)) {
    return false;
  }

  if (!fs.existsSync(resolvedTarget)) {
    return false;
  }

  fs.rmSync(resolvedTarget, {
    recursive: options?.recursive ?? false,
    force: true
  });
  return true;
}

export function removeJobOutputDir(outputPath: string, outputsRoot: string): boolean {
  return removePathWithinRoot(outputPath, outputsRoot, { recursive: true });
}

export function removeJobLogFile(jobId: string, logsRoot: string): boolean {
  return removePathWithinRoot(path.join(logsRoot, `${jobId}.log`), logsRoot);
}
