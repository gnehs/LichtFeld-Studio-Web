import { Router } from "express";
import { jobService } from "../services/jobService.js";

export const systemRouter = Router();

systemRouter.get("/disk", async (_req, res) => {
  try {
    const status = await jobService.getDiskStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: `Failed to read disk status: ${(error as Error).message}` });
  }
});
