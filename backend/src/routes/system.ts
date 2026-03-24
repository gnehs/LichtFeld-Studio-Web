import { Router } from "express";
import { jobService } from "../services/jobService.js";

export const systemRouter = Router();

systemRouter.get("/disk", async (_req, res) => {
  const status = await jobService.getDiskStatus();
  res.json(status);
});
