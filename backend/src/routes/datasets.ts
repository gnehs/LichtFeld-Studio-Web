import fs from "node:fs";
import type { Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import {
  formatTusMetadata,
  parseTusMetadata,
  TUS_RESUMABLE_VERSION,
  tusUploadStore
} from "../lib/tusUploadStore.js";
import { datasetService } from "../services/datasetService.js";

const uploadDir = path.join(config.datasetsDir, "_uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

const registerSchema = z.object({
  datasetName: z.string().min(1),
  targetPath: z.string().min(1)
});

const renameSchema = z.object({
  datasetName: z.string().min(1)
});

export const datasetsRouter = Router();

function setTusHeaders(res: Response) {
  res.setHeader("Tus-Resumable", TUS_RESUMABLE_VERSION);
  res.setHeader("Tus-Version", TUS_RESUMABLE_VERSION);
  res.setHeader("Tus-Extension", "creation");
  res.setHeader("Cache-Control", "no-store");
}

function setTusUploadExpiresHeader(
  res: Response,
  upload: Parameters<typeof tusUploadStore.getUploadExpiresAt>[0],
) {
  res.setHeader("Upload-Expires", tusUploadStore.getUploadExpiresAt(upload));
}

function ensureTusVersion(req: Request, res: Response) {
  const version = req.header("Tus-Resumable");
  if (version === TUS_RESUMABLE_VERSION) {
    return true;
  }

  setTusHeaders(res);
  res.status(412).json({ message: `Unsupported Tus-Resumable version: ${version ?? "missing"}` });
  return false;
}

datasetsRouter.get("/", (_req, res) => {
  try {
    datasetService.autoRegisterMissingFromDatasetsDir();
  } catch (error) {
    console.warn("[datasets] auto register scan failed", error);
  }
  res.json({ items: datasetService.list(), folders: datasetService.listDatasetFolders() });
});

datasetsRouter.get("/folders/:name/preview", (req, res) => {
  const imagePath = datasetService.resolvePreviewImagePath({
    folderName: req.params.name,
    imageRelativePath: typeof req.query.path === "string" ? req.query.path : undefined
  });

  if (!imagePath) {
    return res.status(404).json({ message: "Dataset preview not found" });
  }

  return res.sendFile(imagePath);
});

datasetsRouter.options("/upload/tus", (_req, res) => {
  setTusHeaders(res);
  res.status(204).end();
});

datasetsRouter.options("/upload/tus/:id", (_req, res) => {
  setTusHeaders(res);
  res.status(204).end();
});

datasetsRouter.post("/upload/tus", (req, res) => {
  if (!ensureTusVersion(req, res)) {
    return;
  }

  try {
    const upload = tusUploadStore.createUpload({
      uploadLength: tusUploadStore.parseUploadLength(req.header("Upload-Length")),
      metadata: parseTusMetadata(req.header("Upload-Metadata"))
    });

    setTusHeaders(res);
    res.setHeader("Location", `/api/datasets/upload/tus/${upload.id}`);
    res.setHeader("Upload-Offset", String(upload.uploadOffset));
    setTusUploadExpiresHeader(res, upload);
    res.status(201).end();
  } catch (error) {
    setTusHeaders(res);
    res.status(400).json({ message: (error as Error).message });
  }
});

datasetsRouter.head("/upload/tus/:id", (req, res) => {
  if (!ensureTusVersion(req, res)) {
    return;
  }

  const upload = tusUploadStore.getUpload(req.params.id);
  if (!upload) {
    setTusHeaders(res);
    res.status(404).end();
    return;
  }

  setTusHeaders(res);
  res.setHeader("Upload-Offset", String(upload.uploadOffset));
  res.setHeader("Upload-Length", String(upload.uploadLength));
  res.setHeader("Upload-Metadata", formatTusMetadata(upload.metadata));
  setTusUploadExpiresHeader(res, upload);
  res.status(200).end();
});

datasetsRouter.patch("/upload/tus/:id", async (req, res) => {
  if (!ensureTusVersion(req, res)) {
    return;
  }

  try {
    const upload = await tusUploadStore.appendChunk(req.params.id, Number(req.header("Upload-Offset")), req);
    setTusHeaders(res);
    res.setHeader("Upload-Offset", String(upload.uploadOffset));
    setTusUploadExpiresHeader(res, upload);
    res.status(204).end();
  } catch (error) {
    const currentOffset = (error as Error & { currentOffset?: number }).currentOffset;
    setTusHeaders(res);
    if (typeof currentOffset === "number") {
      res.setHeader("Upload-Offset", String(currentOffset));
      res.status(409).json({ message: (error as Error).message });
      return;
    }

    const message = (error as Error).message;
    const statusCode = message.includes("not found") ? 404 : message.includes("exceeds") ? 413 : 400;
    res.status(statusCode).json({ message });
  }
});

datasetsRouter.post("/upload/tus/:id/complete", async (req, res) => {
  try {
    const item = await tusUploadStore.completeUpload(req.params.id);
    res.json({ item });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("not complete") ? 409 : message.includes("not found") ? 404 : 400;
    res.status(statusCode).json({ message });
  }
});

datasetsRouter.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "file is required" });
    }

    const item = await datasetService.createFromUpload({
      originalName: req.file.originalname,
      zipPath: req.file.path,
      datasetName: req.body?.datasetName
    });

    return res.json({ item });
  } catch (error) {
    return res.status(400).json({ message: (error as Error).message });
  }
});

datasetsRouter.post("/register-path", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  try {
    const item = datasetService.createFromPath(parsed.data);
    return res.json({ item });
  } catch (error) {
    return res.status(400).json({ message: (error as Error).message });
  }
});

datasetsRouter.patch("/:id", (req, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  try {
    const item = datasetService.rename(req.params.id, parsed.data.datasetName);
    return res.json({ item });
  } catch (error) {
    return res.status(400).json({ message: (error as Error).message });
  }
});
