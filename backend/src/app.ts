import fs from "node:fs";
import path from "node:path";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config.js";
import { getSessionCookieSecure, getSessionTrustProxy } from "./lib/sessionConfig.js";
import { authRouter } from "./routes/auth.js";
import { datasetsRouter } from "./routes/datasets.js";
import { jobsRouter } from "./routes/jobs.js";
import { systemRouter } from "./routes/system.js";
import { requireAuth } from "./middleware/auth.js";

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
  app.use(express.json({ limit: "15mb" }));
  app.use(
    session({
      name: "lfs.sid",
      secret: config.sessionSecret,
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

  return app;
}
