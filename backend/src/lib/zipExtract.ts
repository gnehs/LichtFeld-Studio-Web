import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

async function extractWithUnzipper(zipPath: string, targetDir: string): Promise<void> {
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

async function extractWithSystemUnzip(zipPath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(targetDir, { recursive: true });
    
    const child = spawn("unzip", ["-q", "-o", zipPath, "-d", targetDir]);
    
    let errorOutput = "";
    
    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });
    
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn unzip: ${error.message}`));
    });
    
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`unzip process exited with code ${code}. Error: ${errorOutput}`));
      }
    });
  });
}

export async function extractZipToDirectory(zipPath: string, targetDir: string): Promise<void> {
  try {
    // Try system unzip first as it handles massive files (> 2GiB) much better and faster
    await extractWithSystemUnzip(zipPath, targetDir);
  } catch (error) {
    console.warn(`[zipExtract] System unzip failed, falling back to unzipper: ${(error as Error).message}`);
    // Fallback to unzipper for portability (e.g. Windows without unzip)
    await extractWithUnzipper(zipPath, targetDir);
  }
}
