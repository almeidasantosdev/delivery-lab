import type { Server } from "node:http";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createPgDb } from "./db.js";
import { log } from "./log.js";
import { startWorker } from "./worker.js";

const config = readConfig(process.env);
const db = createPgDb(config.databaseUrl);

await db.migrate();
const app = createApp(db);
const stopWorker = startWorker(db, config.workerIntervalMs);

const server = app.listen(config.port, "0.0.0.0", () => {
  log("info", "api ouvindo", { port: config.port });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log("info", "encerrando", { signal });
  stopWorker();
  await closeServer(server);
  await db.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

function closeServer(httpServer: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
