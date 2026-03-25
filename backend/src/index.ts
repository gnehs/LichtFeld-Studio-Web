import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`LichtFeld-Studio Web API listening on :${config.port}`);
});
