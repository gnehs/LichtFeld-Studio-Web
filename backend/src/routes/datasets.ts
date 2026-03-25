import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
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

datasetsRouter.get("/", (_req, res) => {
  try {
    datasetService.autoRegisterMissingFromDatasetsDir();
  } catch (error) {
    console.warn("[datasets] auto register scan failed", error);
  }
  res.json({ items: datasetService.list(), folders: datasetService.listDatasetFolders() });
});

datasetsRouter.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "file is required" });
    }

    const item = datasetService.createFromUpload({
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
