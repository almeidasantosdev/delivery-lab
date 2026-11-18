import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import type { Db } from "./db.js";
import { log } from "./log.js";
import { httpRequests, register, webhookEvents } from "./metrics.js";
import { acceptWebhook, getJob, getWebhook } from "./store.js";
import { HttpError, parseWebhook } from "./validate.js";

export function createApp(db: Db): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    res.on("finish", () => {
      const route = req.route?.path ? String(req.route.path) : "unmatched";
      httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  });

  app.get("/health", asyncRoute(async (_req, res) => {
    await db.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  }));

  app.get("/metrics", asyncRoute(async (_req, res) => {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  }));

  app.post("/webhooks/payments", asyncRoute(async (req, res) => {
    const input = parseWebhook(req.body);
    const accepted = await acceptWebhook(db, input);
    webhookEvents.inc({ result: accepted.duplicate ? "duplicate" : "accepted" });
    log("info", "webhook recebido", {
      idempotencyKey: accepted.idempotencyKey,
      jobId: accepted.jobId,
      duplicate: accepted.duplicate,
    });
    res.status(accepted.duplicate ? 200 : 202).json({
      duplicate: accepted.duplicate,
      idempotency_key: accepted.idempotencyKey,
      event_id: accepted.eventId,
      job_id: accepted.jobId,
      status: accepted.status,
    });
  }));

  app.get("/webhooks/:key", asyncRoute(async (req, res) => {
    const webhook = await getWebhook(db, req.params.key);
    if (!webhook) {
      throw new HttpError(404, "webhook nao encontrado");
    }
    res.status(200).json({
      idempotency_key: webhook.idempotencyKey,
      event_type: webhook.eventType,
      status: webhook.status,
      payload: webhook.payload,
      job: {
        id: webhook.job.id,
        status: webhook.job.status,
        attempts: webhook.job.attempts,
        max_attempts: webhook.job.maxAttempts,
        fail_until_attempt: webhook.job.failUntilAttempt,
        last_error: webhook.job.lastError,
        next_attempt_at: webhook.job.nextAttemptAt,
      },
    });
  }));

  app.get("/jobs/:id", asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new HttpError(400, "id invalido");
    }
    const job = await getJob(db, id);
    if (!job) {
      throw new HttpError(404, "job nao encontrado");
    }
    res.status(200).json({
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      fail_until_attempt: job.failUntilAttempt,
      last_error: job.lastError,
      next_attempt_at: job.nextAttemptAt,
    });
  }));

  app.use(errorHandler);
  return app;
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: "JSON invalido" });
    return;
  }
  log("error", "erro nao tratado", { error: error instanceof Error ? error.message : "erro desconhecido" });
  res.status(500).json({ error: "erro interno" });
};
