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
        hasAlphaImages: inspected.hasAlphaImages
      });
    }

    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return folders;
  },

  async createFromUpload(params: { originalName: string; zipPath: string; datasetName?: string }) {
    const id = nanoid();
    const name = params.datasetName?.trim() || params.originalName.replace(/\.[^.]+$/, "");
    const extractDir = path.join(config.datasetsDir, id);
    const markerPath = path.join(extractDir, UPLOAD_IN_PROGRESS_MARKER);
    fs.mkdirSync(extractDir, { recursive: true });
    fs.writeFileSync(markerPath, "1");

    try {
      await extractZipToDirectory(params.zipPath, extractDir);

      const structure = validateDatasetStructure(extractDir);
      if (!structure.valid) {
        throw new Error(`Invalid dataset: ${structure.reason}`);
      }

      const record: DatasetRecord = {
        id,
        name,
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
