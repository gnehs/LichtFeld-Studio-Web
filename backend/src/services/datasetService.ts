import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { repo } from "../db.js";
import type { DatasetRecord } from "../types/models.js";

function normalizePath(targetPath: string): string {
  return path.resolve(targetPath);
}

function validateDatasetStructure(datasetPath: string): { valid: boolean; reason?: string } {
  const sparseDir = path.join(datasetPath, "sparse");
  const imagesDir = path.join(datasetPath, "images");
  if (!fs.existsSync(sparseDir)) {
    return { valid: false, reason: "Missing sparse/ directory" };
  }
  if (!fs.existsSync(imagesDir)) {
    return { valid: false, reason: "Missing images/ directory" };
  }
  return { valid: true };
}

function isAllowedPath(targetPath: string): boolean {
  const normalized = normalizePath(targetPath);
  return config.allowedDatasetRoots.some((root) => normalized.startsWith(root));
}

export const datasetService = {
  list() {
    return repo.listDatasets();
  },

  createFromUpload(params: { originalName: string; zipPath: string; datasetName?: string }) {
    const id = nanoid();
    const name = params.datasetName?.trim() || params.originalName.replace(/\.[^.]+$/, "");
    const extractDir = path.join(config.datasetsDir, id);
    fs.mkdirSync(extractDir, { recursive: true });

    const zip = new AdmZip(params.zipPath);
    zip.extractAllTo(extractDir, true);

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
