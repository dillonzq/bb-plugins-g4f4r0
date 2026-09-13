import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { configSchema } from "./schema.js";
import { Store } from "./store.js";
import { createApp } from "./api.js";
const file = process.argv[2];
if (!file) throw Error("Usage: node dist/main.js /path/to/config.json");
const config = configSchema.parse(JSON.parse(readFileSync(file, "utf8"))),
  store = new Store(config.dataDir, readFileSync(config.keyFile)),
  app = createApp(config, store);
app.use(
  "*",
  serveStatic({ root: fileURLToPath(new URL("./public", import.meta.url)) }),
);
const server = serve({
  fetch: app.fetch,
  hostname: config.listen,
  port: config.port,
});
const timer = setInterval(() => store.expire(), 5000);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdout.write(
  "1Password approval service listening on " +
    config.listen +
    ":" +
    config.port +
    "\n",
);
