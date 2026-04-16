import { config } from "./config.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { startSessionCleanup } from "./lib/sessionStore.js";
import { startMetricsPoller } from "./lib/systemMetrics.js";

// 捕捉未處理的 Promise rejection 與同步例外，確保 Docker log 看得到
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", logger.errFields(reason));
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", logger.errFields(err));
  process.exit(1);
});

const app = createApp();
const sessionCleanup = startSessionCleanup(config.sessionCleanupIntervalMs);
startMetricsPoller();

const server = app.listen(config.port, () => {
  logger.info("LichtFeld-Studio Web API started", { port: config.port, env: config.nodeEnv });
});

server.on("close", () => {
  sessionCleanup.stop();
});
