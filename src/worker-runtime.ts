import http from "node:http";
import { readWorkerConfig } from "./config";
import { createPgDb, type Db } from "./db";
import { handleDelivery } from "./delivery";
import { log } from "./log";
import { register } from "./metrics";
import { publishPending } from "./publisher";
import { createBroker, type RabbitBroker } from "./rabbit";

export type WorkerRuntime = {
  port: number;
  stop: () => Promise<void>;
};

export async function startWorkerRuntime(env: NodeJS.ProcessEnv = process.env): Promise<WorkerRuntime> {
  const config = readWorkerConfig(env);
  const db = createPgDb(config.databaseUrl);
  await db.migrate();
  const broker = await createBroker(config.rabbitmqUrl);
  const consumer = await broker.consume(async (message, raw) => {
    await handleDelivery(db, broker, message.jobId, message.attempt, {
      backoffBaseMs: config.backoffBaseMs,
    }, raw.fields.redelivered);
  });

  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    publishPending(db, broker)
      .catch((error: unknown) => {
        log("error", "falha ao publicar outbox", { error: error instanceof Error ? error.message : "erro desconhecido" });
      })
      .finally(() => {
        busy = false;
      });
  }, config.workerIntervalMs);
  timer.unref?.();

  const server = http.createServer((req, res) => {
    void respond(req, res, db, broker);
  });
  await listen(server, config.workerHealthPort);
  log("info", "worker ouvindo", { port: config.workerHealthPort });

  return {
    port: config.workerHealthPort,
    async stop() {
      clearInterval(timer);
      await closeServer(server).catch(() => undefined);
      await consumer.close().catch(() => undefined);
      await broker.close().catch(() => undefined);
      await db.close().catch(() => undefined);
    },
  };
}

async function respond(req: http.IncomingMessage, res: http.ServerResponse, db: Db, broker: RabbitBroker): Promise<void> {
  try {
    if (req.url === "/health") {
      await db.query("SELECT 1");
      await broker.ping();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": register.contentType });
      res.end(await register.metrics());
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "nao encontrado" }));
  } catch (error) {
    log("error", "falha no health do worker", { error: error instanceof Error ? error.message : "erro desconhecido" });
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "down" }));
  }
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
