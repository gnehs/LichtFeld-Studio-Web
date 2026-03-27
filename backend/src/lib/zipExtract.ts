import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";

function normalizeZipEntryPath(entryPath: string): string {
  return entryPath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .join(path.sep);
}

function resolveEntryPath(rootDir: string, entryPath: string): string {
  const normalizedEntryPath = normalizeZipEntryPath(entryPath);
  const rootPath = path.resolve(rootDir);
  const targetPath = path.resolve(rootPath, normalizedEntryPath);

  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`Zip entry escapes target directory: ${entryPath}`);
  }

  return targetPath;
}

export async function extractZipToDirectory(zipPath: string, targetDir: string): Promise<void> {
  const directory = await unzipper.Open.file(zipPath);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of directory.files) {
    const outputPath = resolveEntryPath(targetDir, file.path);

    if (file.type === "Directory") {
      fs.mkdirSync(outputPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await pipeline(file.stream(), fs.createWriteStream(outputPath));
  }
}
