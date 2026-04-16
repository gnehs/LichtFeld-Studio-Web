import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config.js";
import { getSessionCookieSecure, getSessionTrustProxy } from "./lib/sessionConfig.js";
import { sessionStore } from "./lib/sessionStore.js";
import { logger } from "./lib/logger.js";
import { authRouter } from "./routes/auth.js";
import { datasetsRouter } from "./routes/datasets.js";
import { jobsRouter } from "./routes/jobs.js";
import { systemRouter } from "./routes/system.js";
import { requireAuth } from "./middleware/auth.js";

/** HTTP request logger middleware */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  // TUS PATCH 上傳 chunk 非常頻繁，預設降為 debug 層級避免洗版
  const isTusChunk = req.method === "PATCH" && req.path.includes("/upload/tus/");

  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : isTusChunk ? "debug" : "info";

    // 從 X-Forwarded-For 或 socket 取得客戶端 IP
    const ip =
      (typeof req.headers["x-forwarded-for"] === "string"
        ? req.headers["x-forwarded-for"].split(",")[0]
        : null) ??
      req.socket.remoteAddress ??
      "-";

    const fields: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      status,
      ms,
      ip
    };

    // 上傳 chunk 額外記錄 offset 方便對帳
    if (isTusChunk) {
      const offset = req.headers["upload-offset"];
      if (offset !== undefined) fields.upload_offset = offset;
    }

    logger[level](`${req.method} ${req.path} ${status} ${ms}ms`, fields);
  });

  next();
}

/** 捕捉所有未處理的 Express 錯誤，確保一定有 log */
function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status = (err as { status?: number; statusCode?: number })?.status ??
                 (err as { status?: number; statusCode?: number })?.statusCode ?? 500;

  logger.error("Unhandled request error", {
    method: req.method,
    path: req.path,
    status,
    ...logger.errFields(err)
  });

  if (res.headersSent) return;
  res.status(status).json({ message: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
}

export function createApp() {
  const app = express();

  // In production, trust a single reverse proxy so Secure cookies can follow X-Forwarded-Proto.
  app.set("trust proxy", getSessionTrustProxy(config.nodeEnv));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );

  // HTTP request logging（最早掛，確保所有請求都被記錄）
  app.use(requestLogger);

  app.use(express.json({ limit: "15mb" }));
  app.use(
    session({
      name: "lfs.sid",
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: getSessionCookieSecure(config.nodeEnv),
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 12
      }
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/datasets", requireAuth, datasetsRouter);
  app.use("/api/jobs", requireAuth, jobsRouter);
  app.use("/api/system", requireAuth, systemRouter);

  const frontendDist = path.resolve(process.cwd(), "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        return next();
      }
      return res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  // Global error handler（必須放在所有 route 之後）
  app.use(globalErrorHandler);

  return app;
}
