import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

const PREVIEW_DIR_NAME = ".web-preview";
const MODAL_EXPORT_DIR_NAME = "modal-exports";
const SUPPORTED_SOURCE_EXTENSIONS = new Set([".html", ".ply", ".resume", ".sog", ".spz"]);
const CONVERTIBLE_SOURCE_EXTENSIONS = new Set([".ply", ".resume", ".sog", ".spz"]);
const conversionPromises = new Map<string, Promise<void>>();
const conversionFailures = new Map<string, string>();

export type SplatSourceType = "html" | "ply" | "resume" | "sog" | "spz";
export type SplatExportFormat = "ply" | "sog" | "spz" | "html";
export const DEFAULT_SPLAT_EXPORT_FORMAT: SplatExportFormat = "sog";

export interface SplatSource {
  path: string;
  type: SplatSourceType;
  mtimeMs: number;
  sizeBytes: number;
  iteration: number | null;
}

export type SplatSnapshot =
  | {
      available: false;
      status: "missing";
      message: string;
    }
  | {
      available: true;
      status: "ready" | "converting" | "error";
      source: SplatSource;
      viewerPath: string | null;
      message: string | null;
    };

export interface SplatExportArtifact {
  path: string;
  format: SplatExportFormat;
  source: SplatSource;
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourceTypeFromExtension(extension: string): SplatSourceType | null {
  const normalized = extension.toLowerCase();
  if (normalized === ".html") return "html";
  if (normalized === ".ply") return "ply";
  if (normalized === ".resume") return "resume";
  if (normalized === ".sog") return "sog";
  if (normalized === ".spz") return "spz";
  return null;
}

function parseIteration(filePath: string): number | null {
  const basename = path.basename(filePath);
  const patterns = [
    /(?:^|[_-])splat[_-](\d+)\.ply$/i,
    /(?:^|[_-])iter(?:ation)?[_-](\d+)/i,
    /(?:^|[_-])(\d{3,})(?:\.[^.]+)?$/i
  ];

  for (const pattern of patterns) {
    const match = basename.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }

  return null;
}

async function findLatestSplatSource(
  rootDir: string,
  allowedTypes: ReadonlySet<SplatSourceType> = new Set(["html", "ply", "resume", "sog", "spz"])
): Promise<SplatSource | null> {
  const resolvedRoot = path.resolve(rootDir);
  let best: SplatSource | null = null;

  async function visit(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === PREVIEW_DIR_NAME || entry.name === "timelapse") return;
        await visit(fullPath);
        return;
      }

      if (!entry.isFile()) return;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_SOURCE_EXTENSIONS.has(extension)) return;

      const type = sourceTypeFromExtension(extension);
      if (!type) return;
      if (!allowedTypes.has(type)) return;

      const stat = await fsPromises.stat(fullPath);
      const candidate: SplatSource = {
        path: fullPath,
        type,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        iteration: parseIteration(fullPath)
      };

      if (!best || candidate.mtimeMs > best.mtimeMs) {
        best = candidate;
      }
    }));
  }

  if (!isWithinRoot(resolvedRoot, resolvedRoot)) return null;
  await visit(resolvedRoot);
  return best;
}

function viewerFilePath(outputRoot: string, source: SplatSource): string {
  return convertedFilePath(outputRoot, source, "html", "splat");
}

function convertedFilePath(
  outputRoot: string,
  source: SplatSource,
  format: SplatExportFormat,
  folderName: string
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${path.resolve(source.path)}:${source.mtimeMs}:${source.sizeBytes}:${format}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(outputRoot, PREVIEW_DIR_NAME, folderName, `${hash}.${format}`);
}

function legacyViewerPath(source: SplatSource): string | null {
  return source.type === "html" ? source.path : null;
}

async function getModalPreparedArtifact(
  outputRoot: string,
  format: SplatExportFormat
): Promise<SplatSource | null> {
  const preparedPath = path.join(outputRoot, MODAL_EXPORT_DIR_NAME, `model.${format}`);
  if (!isWithinRoot(preparedPath, outputRoot)) return null;

  try {
    const stat = await fsPromises.stat(preparedPath);
    if (!stat.isFile()) return null;
    return {
      path: preparedPath,
      type: format,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      iteration: null
    };
  } catch {
    return null;
  }
}

function conversionKey(source: SplatSource, targetPath: string): string {
  return `${path.resolve(source.path)}:${source.mtimeMs}:${source.sizeBytes}->${path.resolve(targetPath)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function convertSource(source: SplatSource, targetPath: string, format: SplatExportFormat): Promise<void> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.tmp`;

  try {
    await execFileAsync(config.lfsBinPath, [
      "convert",
      source.path,
      tmpPath,
      "--format",
      format,
      "--overwrite"
    ], {
      maxBuffer: 1024 * 1024 * 8
    });
    await fsPromises.rename(tmpPath, targetPath);
  } catch (error) {
    await fsPromises.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function startConversion(source: SplatSource, targetPath: string, format: SplatExportFormat): Promise<void> {
  const key = conversionKey(source, targetPath);
  const current = conversionPromises.get(key);
  if (current) return current;

  conversionFailures.delete(key);
  const next = convertSource(source, targetPath, format)
    .catch((error: unknown) => {
      conversionFailures.set(key, errorMessage(error));
      throw error;
    })
    .finally(() => {
      conversionPromises.delete(key);
    });
  conversionPromises.set(key, next);
  return next;
}

export async function getSplatSnapshot(outputPath: string): Promise<SplatSnapshot> {
  const outputRoot = path.resolve(outputPath);
  if (!fs.existsSync(outputRoot)) {
    return {
      available: false,
      status: "missing",
      message: "Model output not found"
    };
  }

  const modalViewer = await getModalPreparedArtifact(outputRoot, "html");
  if (modalViewer) {
    return {
      available: true,
      status: "ready",
      source: modalViewer,
      viewerPath: modalViewer.path,
      message: null
    };
  }

  const source = await findLatestSplatSource(outputRoot);
  if (!source) {
    return {
      available: false,
      status: "missing",
      message: "No splat, checkpoint, or HTML viewer output found"
    };
  }

  const existingHtml = legacyViewerPath(source);
  if (existingHtml) {
    return {
      available: true,
      status: "ready",
      source,
      viewerPath: existingHtml,
      message: null
    };
  }

  if (!CONVERTIBLE_SOURCE_EXTENSIONS.has(path.extname(source.path).toLowerCase())) {
    return {
      available: true,
      status: "error",
      source,
      viewerPath: null,
      message: "Unsupported splat source format"
    };
  }

  const targetPath = viewerFilePath(outputRoot, source);
  if (fs.existsSync(targetPath)) {
    return {
      available: true,
      status: "ready",
      source,
      viewerPath: targetPath,
      message: null
    };
  }

  const key = conversionKey(source, targetPath);
  const failure = conversionFailures.get(key);
  if (failure) {
    return {
      available: true,
      status: "error",
      source,
      viewerPath: null,
      message: `Failed to prepare splat viewer: ${failure}`
    };
  }

  const conversion = startConversion(source, targetPath, "html");
  conversion.catch(() => undefined);

  return {
    available: true,
    status: "converting",
    source,
    viewerPath: null,
    message: "Preparing browser viewer from latest splat snapshot"
  };
}

export function parseSplatExportFormat(value: unknown): SplatExportFormat | null {
  const normalized = String(value ?? DEFAULT_SPLAT_EXPORT_FORMAT).trim().toLowerCase();
  if (normalized === "ply" || normalized === "sog" || normalized === "spz" || normalized === "html") {
    return normalized;
  }
  return null;
}

export async function getSplatExportArtifact(
  outputPath: string,
  format: SplatExportFormat
): Promise<SplatExportArtifact | null> {
  const outputRoot = path.resolve(outputPath);
  if (!fs.existsSync(outputRoot)) return null;

  const modalArtifact = await getModalPreparedArtifact(outputRoot, format);
  if (modalArtifact) {
    return { path: modalArtifact.path, format, source: modalArtifact };
  }

  const allowedTypes = format === "html"
    ? new Set<SplatSourceType>(["html", "ply", "resume", "sog", "spz"])
    : new Set<SplatSourceType>(["ply", "resume", "sog", "spz"]);
  const source = await findLatestSplatSource(outputRoot, allowedTypes);
  if (!source) return null;

  if (source.type === format) {
    return { path: source.path, format, source };
  }

  if (!CONVERTIBLE_SOURCE_EXTENSIONS.has(path.extname(source.path).toLowerCase())) {
    throw new Error(`Cannot export ${source.type} source as ${format}`);
  }

  const targetPath = convertedFilePath(outputRoot, source, format, "exports");
  if (!fs.existsSync(targetPath)) {
    await startConversion(source, targetPath, format);
  }

  return { path: targetPath, format, source };
}

export function ensureViewerPathAllowed(viewerPath: string, outputPath: string): boolean {
  return isWithinRoot(viewerPath, outputPath);
}
