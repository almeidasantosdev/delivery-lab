import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { json } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DEAD_QUEUE, JOBS_QUEUE, createBroker, retryQueues } from "../src/rabbit";
import { startWorkerRuntime, type WorkerRuntime } from "../src/worker-runtime";

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;

if (!databaseUrl || !rabbitmqUrl) {
  throw new Error("DATABASE_URL e RABBITMQ_URL sao obrigatorias para o teste de integracao");
}

process.env.BACKOFF_BASE_MS = "0";
process.env.WORKER_INTERVAL_MS = "100";
process.env.WORKER_HEALTH_PORT = process.env.WORKER_HEALTH_PORT || "3001";

describe("webhook, outbox e RabbitMQ", () => {
  let app: INestApplication;
  let worker: WorkerRuntime;

  beforeAll(async () => {
    const broker = await createBroker(rabbitmqUrl);
    const channel = await broker.connection.createChannel();
    for (const queue of [JOBS_QUEUE, DEAD_QUEUE, ...retryQueues()]) {
      await channel.purgeQueue(queue);
    }
    await channel.close();
    await broker.close();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(json({ limit: "256kb" }));
    await app.init();
    await app.getHttpServer();
    const db = app.get("DB");
    await db.query("TRUNCATE TABLE outbox, delivery_jobs, webhook_events RESTART IDENTITY CASCADE");
    worker = await startWorkerRuntime(process.env);
  }, 30_000);

  afterAll(async () => {
    await worker?.stop();
    await app?.close();
  });

  it("grava o webhook uma vez e devolve o mesmo job na repeticao", async () => {
    const body = {
      idempotency_key: "evt_once",
      event_type: "payment.confirmed",
      payload: { amount_cents: 1500 },
    };
    const created = await request(app.getHttpServer()).post("/webhooks/payments").send(body);
    expect(created.status).toBe(202);
    expect(created.body.duplicate).toBe(false);

    const repeated = await request(app.getHttpServer()).post("/webhooks/payments").send(body);
    expect(repeated.status).toBe(200);
    expect(repeated.body.duplicate).toBe(true);
    expect(repeated.body.job_id).toBe(created.body.job_id);
  });

  it("publica no RabbitMQ e consome ate entregar", async () => {
    const done = await waitForStatus(app, "evt_once", "delivered");
    expect(done.job.attempts).toBe(1);
    expect(done.job.last_error).toBeNull();
  });

  it("retenta ate passar das falhas simuladas", async () => {
    const created = await request(app.getHttpServer()).post("/webhooks/payments").send({
      idempotency_key: "evt_retry",
      event_type: "payment.confirmed",
      fail_until_attempt: 2,
    });
    expect(created.status).toBe(202);

    const done = await waitForStatus(app, "evt_retry", "delivered");
    expect(done.job.attempts).toBe(3);
    expect(done.job.last_error).toBeNull();
  });

  it("envia para a DLQ quando as tentativas se esgotam", async () => {
    const created = await request(app.getHttpServer()).post("/webhooks/payments").send({
      idempotency_key: "evt_dead",
      event_type: "payment.confirmed",
      fail_until_attempt: 10,
    });
    expect(created.status).toBe(202);

    const done = await waitForStatus(app, "evt_dead", "failed");
    expect(done.job.attempts).toBe(5);
    expect(done.job.last_error).toBe("provider_timeout");

    const broker = await createBroker(rabbitmqUrl);
    const channel = await broker.connection.createChannel();
    const message = await waitForDeadLetter(channel, created.body.job_id);
    expect(JSON.parse(message.content.toString()).jobId).toBe(created.body.job_id);
    await channel.close();
    await broker.close();
  });

  it("responde 400 para corpo invalido e expoe saude e metricas", async () => {
    const invalid = await request(app.getHttpServer())
      .post("/webhooks/payments")
      .set("content-type", "application/json")
      .send("{");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("JSON invalido");

    const missing = await request(app.getHttpServer()).get("/webhooks/nao-existe");
    expect(missing.status).toBe(404);

    const health = await request(app.getHttpServer()).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");

    const metrics = await request(app.getHttpServer()).get("/metrics");
    expect(metrics.text).toContain("http_requests_total");
    expect(metrics.text).toContain("webhook_events_total");

    const workerHealth = await fetch(`http://127.0.0.1:${worker.port}/health`);
    expect(workerHealth.status).toBe(200);
    const workerMetrics = await fetch(`http://127.0.0.1:${worker.port}/metrics`);
    const workerText = await workerMetrics.text();
    expect(workerText).toContain("delivery_attempts_total");
    expect(workerText).toContain("outbox_published_total");
  });
});

async function waitForStatus(
  app: INestApplication,
  key: string,
  status: string,
): Promise<{ status: string; job: { attempts: number; last_error: string | null } }> {
  const deadline = Date.now() + 15_000;
  let last = "";
  while (Date.now() < deadline) {
    const response = await request(app.getHttpServer()).get(`/webhooks/${key}`);
    last = JSON.stringify(response.body);
    if (response.status === 200 && response.body.status === status) {
      return response.body;
    }
    await delay(100);
  }
  throw new Error(`timeout esperando ${key} = ${status}; ultimo=${last}`);
}

async function waitForDeadLetter(
  channel: { get(queue: string, options: { noAck: boolean }): Promise<{ content: Buffer } | false> },
  jobId: number,
): Promise<{ content: Buffer }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const message = await channel.get(DEAD_QUEUE, { noAck: true });
    if (message && JSON.parse(message.content.toString()).jobId === jobId) {
      return message;
    }
    await delay(100);
  }
  throw new Error("timeout esperando mensagem na DLQ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
