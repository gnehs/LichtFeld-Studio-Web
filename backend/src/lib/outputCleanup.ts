import fs from "node:fs";
import path from "node:path";

function isSubPath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function removeJobOutputDir(outputPath: string, outputsRoot: string): boolean {
  const resolvedOutput = path.resolve(outputPath);
  const resolvedRoot = path.resolve(outputsRoot);

  if (!isSubPath(resolvedOutput, resolvedRoot)) {
    return false;
  }

  if (!fs.existsSync(resolvedOutput)) {
    return false;
  }

  fs.rmSync(resolvedOutput, { recursive: true, force: true });
  return true;
}
