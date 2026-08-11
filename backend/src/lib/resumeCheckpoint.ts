import fs from "node:fs/promises";
import path from "node:path";

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(
    path.resolve(rootPath),
    path.resolve(targetPath),
  );
  return (
    relative === "" ||
    (relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative))
  );
}

/** Return LichtFeld's fixed, atomically-written training checkpoint. */
export async function findResumeCheckpoint(
  outputPath: string,
): Promise<string | null> {
  const outputRoot = path.resolve(outputPath);
  const checkpointPath = path.join(
    outputRoot,
    "checkpoints",
    "checkpoint.resume",
  );
  if (!isWithinRoot(checkpointPath, outputRoot)) return null;

  try {
    const checkpointStat = await fs.lstat(checkpointPath);
    if (!checkpointStat.isFile() || checkpointStat.isSymbolicLink())
      return null;
    const [realOutputRoot, realCheckpointPath] = await Promise.all([
      fs.realpath(outputRoot),
      fs.realpath(checkpointPath),
    ]);
    return isWithinRoot(realCheckpointPath, realOutputRoot)
      ? realCheckpointPath
      : null;
  } catch {
    return null;
  }
}
