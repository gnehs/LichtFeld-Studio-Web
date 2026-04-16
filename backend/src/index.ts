import { config } from "./config.js";
import { createApp } from "./app.js";
import { startSessionCleanup } from "./lib/sessionStore.js";
import { startMetricsPoller } from "./lib/systemMetrics.js";

const app = createApp();
const sessionCleanup = startSessionCleanup(config.sessionCleanupIntervalMs);
startMetricsPoller();

const server = app.listen(config.port, () => {
  console.log(`LichtFeld-Studio Web API listening on :${config.port}`);
});

server.on("close", () => {
  sessionCleanup.stop();
});
