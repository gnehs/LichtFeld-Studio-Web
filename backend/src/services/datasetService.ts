import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { repo } from "../db.js";
import { extractZipToDirectory } from "../lib/zipExtract.js";
import type { DatasetFolderEntry, DatasetRecord } from "../types/models.js";
import {
  evaluateDatasetForAutoRegister,
  inspectDatasetFolder,
  UPLOAD_IN_PROGRESS_MARKER,
  validateDatasetStructure
} from "../lib/datasetAutoRegister.js";
import { IMAGE_EXTENSIONS, pickDatasetPreviewImageRelativePath } from "../lib/datasetImages.js";

function normalizePath(targetPath: string): string {
  return path.resolve(targetPath);
}

function isAllowedPath(targetPath: string): boolean {
  const normalized = normalizePath(targetPath);
  return config.allowedDatasetRoots.some((root) => normalized === root || normalized.startsWith(root + path.sep));
}

function removePathSafe(targetPath: string) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function stripFileExtension(fileName: string): string {
  const baseName = path.basename(fileName.trim());
  return baseName.replace(/\.[^.]+$/, "").trim();
}

function normalizeUploadFolderName(rawName: string): string {
  const sanitized = rawName
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[._\- ]+/, "")
    .replace(/[. ]+$/g, "")
    .trim();

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error("datasetName is invalid");
  }

  return sanitized;
}

function resolveUploadNames(params: {
  originalName: string;
  datasetName?: string;
}) {
  const preferredName = params.datasetName?.trim() || stripFileExtension(params.originalName) || "dataset";
  const folderName = normalizeUploadFolderName(preferredName);
  return {
    displayName: folderName,
    folderName,
  };
}

export const datasetService = {
  list() {
    return repo.listDatasets();
  },

  autoRegisterMissingFromDatasetsDir() {
    const existing = repo.listDatasets();
    const knownPathSet = new Set(existing.map((item) => normalizePath(item.path)));
    const created: DatasetRecord[] = [];
    const entries = fs.readdirSync(config.datasetsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

      const datasetPath = normalizePath(path.join(config.datasetsDir, entry.name));
      if (knownPathSet.has(datasetPath)) continue;

      const judged = evaluateDatasetForAutoRegister(datasetPath);
      if (!judged.ok) continue;

      const record: DatasetRecord = {
        id: nanoid(),
        name: entry.name,
        type: "registered",
        path: datasetPath,
        createdAt: new Date().toISOString()
      };

      try {
        const item = repo.createDataset(record);
        created.push(item);
        knownPathSet.add(datasetPath);
      } catch {
        // Ignore concurrent insert races and keep list endpoint available.
      }
    }

    return created;
  },

  listDatasetFolders() {
    const existing = repo.listDatasets();
    const registeredByPath = new Map(existing.map((dataset) => [normalizePath(dataset.path), dataset]));
    const entries = fs.readdirSync(config.datasetsDir, { withFileTypes: true });
    const folders: DatasetFolderEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

      const datasetPath = normalizePath(path.join(config.datasetsDir, entry.name));
      const registered = registeredByPath.get(datasetPath);
      const inspected = inspectDatasetFolder(datasetPath);
      folders.push({
        name: entry.name,
        path: datasetPath,
        datasetId: registered?.id ?? null,
        isRegistered: Boolean(registered),
        health: inspected.status,
        reason: inspected.reason,
        imageCount: inspected.imageCount,
        hasMasks: inspected.hasMasks,
        hasAlphaImages: inspected.hasAlphaImages,
        previewImageRelativePath: inspected.previewImageRelativePath
      });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return folders;
  },

  resolvePreviewImagePath(params: { folderName: string; imageRelativePath?: string }) {
    const datasetsRoot = normalizePath(config.datasetsDir);
    const datasetPath = normalizePath(path.join(config.datasetsDir, params.folderName));
    if (datasetPath === datasetsRoot || !datasetPath.startsWith(datasetsRoot + path.sep)) {
      return null;
    }

    if (!fs.existsSync(datasetPath) || !fs.statSync(datasetPath).isDirectory()) {
      return null;
    }

    const imagesDir = normalizePath(path.join(datasetPath, "images"));
    const imageRelativePath = params.imageRelativePath?.trim() || pickDatasetPreviewImageRelativePath(imagesDir);
    if (!imageRelativePath) {
      return null;
    }

    if (!IMAGE_EXTENSIONS.has(path.extname(imageRelativePath).toLowerCase())) {
      return null;
    }

    const imagePath = normalizePath(path.join(imagesDir, imageRelativePath));
    if (imagePath === imagesDir || !imagePath.startsWith(imagesDir + path.sep)) {
      return null;
    }

    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
      return null;
    }

    return imagePath;
  },

  async createFromUpload(params: { originalName: string; zipPath: string; datasetName?: string }) {
    const id = nanoid();
    const { displayName, folderName } = resolveUploadNames(params);
    const extractDir = path.join(config.datasetsDir, folderName);
    const markerPath = path.join(extractDir, UPLOAD_IN_PROGRESS_MARKER);
    if (fs.existsSync(extractDir)) {
      throw new Error(`Dataset folder already exists: ${folderName}`);
    }

    fs.mkdirSync(extractDir, { recursive: false });
    fs.writeFileSync(markerPath, "1");

    try {
      await extractZipToDirectory(params.zipPath, extractDir);

      const structure = validateDatasetStructure(extractDir);
      if (!structure.valid) {
        throw new Error(`Invalid dataset: ${structure.reason}`);
      }

      const record: DatasetRecord = {
        id,
        name: displayName,
        type: "upload",
        path: extractDir,
        createdAt: new Date().toISOString()
      };

      return repo.createDataset(record);
    } catch (error) {
      removePathSafe(extractDir);
      throw error;
    } finally {
      removePathSafe(markerPath);
      removePathSafe(params.zipPath);
    }
  },

  rename(id: string, datasetName: string) {
    const existing = repo.getDataset(id);
    if (!existing) {
      throw new Error(`Dataset not found: ${id}`);
    }

    const nextName = datasetName.trim();
    if (!nextName) {
      throw new Error("datasetName is required");
    }

    const updated = repo.updateDatasetName(id, nextName);
    if (!updated) {
      throw new Error(`Dataset not found: ${id}`);
    }

    return updated;
  },

  createFromPath(params: { datasetName: string; targetPath: string }) {
    const normalizedPath = normalizePath(params.targetPath);
    if (!isAllowedPath(normalizedPath)) {
      throw new Error(`Path not allowed: ${normalizedPath}`);
    }

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Path not found: ${normalizedPath}`);
    }

    const structure = validateDatasetStructure(normalizedPath);
    if (!structure.valid) {
      throw new Error(`Invalid dataset: ${structure.reason}`);
    }

    const record: DatasetRecord = {
      id: nanoid(),
      name: params.datasetName,
      type: "registered",
      path: normalizedPath,
      createdAt: new Date().toISOString()
    };

    return repo.createDataset(record);
  }
};
