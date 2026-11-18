import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../app.js";
import type { Db, Queryable } from "../db.js";
import type { QueryResultRow } from "pg";
import { loadSchemaSql } from "../db.js";
import { processOnce } from "../worker.js";

type Json = Record<string, any>;

describe("fluxo de entrega", { concurrency: false }, () => {
  let db: Db;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    db = await createPgliteDb();
    await db.migrate();
    const app = createApp(db);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await db.close();
  });

  it("grava o webhook uma vez e devolve a mesma resposta na repeticao", async () => {
    const body = {
      idempotency_key: "evt_once",
      event_type: "payment.confirmed",
      payload: { amount_cents: 1500 },
    };

    const created = await request("/webhooks/payments", { method: "POST", body });
    assert.equal(created.status, 202);
    assert.equal(created.json.duplicate, false);
    assert.equal(created.json.job_id, 1);

    const repeated = await request("/webhooks/payments", { method: "POST", body });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.json.duplicate, true);
    assert.equal(repeated.json.job_id, created.json.job_id);
  });

  it("entrega na primeira tentativa quando o provedor responde", async () => {
    const result = await processOnce(db, { backoffBaseMs: 0 });
    assert.equal(result, "delivered");

    const job = await request("/jobs/1");
    assert.equal(job.status, 200);
    assert.equal(job.json.status, "delivered");
    assert.equal(job.json.attempts, 1);
  });

  it("retenta ate passar das falhas simuladas", async () => {
    const created = await request("/webhooks/payments", {
      method: "POST",
      body: {
        idempotency_key: "evt_retry",
        event_type: "payment.confirmed",
        fail_until_attempt: 2,
      },
    });
    assert.equal(created.status, 202);

    assert.equal(await processOnce(db, { backoffBaseMs: 0 }), "retry");
    const firstTry = await request(`/webhooks/evt_retry`);
    assert.equal(firstTry.json.job.last_error, "provider_timeout");
    assert.equal(firstTry.json.job.attempts, 1);

    assert.equal(await processOnce(db, { backoffBaseMs: 0 }), "retry");
    assert.equal(await processOnce(db, { backoffBaseMs: 0 }), "delivered");

    const done = await request("/webhooks/evt_retry");
    assert.equal(done.json.status, "delivered");
    assert.equal(done.json.job.attempts, 3);
    assert.equal(done.json.job.last_error, null);
  });

  it("responde 400 para corpo invalido e expoe metricas", async () => {
    const invalid = await request("/webhooks/payments", {
      method: "POST",
      body: { event_type: "payment.confirmed" },
    });
    assert.equal(invalid.status, 400);

    const missing = await request("/webhooks/nao-existe");
    assert.equal(missing.status, 404);

    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.json.status, "ok");

    const metrics = await fetch(`${baseUrl}/metrics`);
    const text = await metrics.text();
    assert.match(text, /http_requests_total/);
    assert.match(text, /delivery_attempts_total/);
  });

  async function request(pathname: string, options?: { method?: string; body?: Json }): Promise<{ status: number; json: Json }> {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options?.method ?? "GET",
      headers: options?.body ? { "content-type": "application/json" } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const json = (await response.json()) as Json;
    return { status: response.status, json };
  }
});

async function createPgliteDb(): Promise<Db> {
  const pglite = new PGlite();
  const queryable: Queryable = {
    query: async <T extends QueryResultRow>(sql: string, params?: unknown[]) => {
      const result = await pglite.query<T>(sql, params);
      return { rows: result.rows };
    },
  };

  return {
    query: queryable.query,
    async migrate() {
      await pglite.exec(loadSchemaSql());
    },
    async transaction(fn) {
      return pglite.transaction(async (tx) => fn({
        query: async <T extends QueryResultRow>(sql: string, params?: unknown[]) => {
          const result = await tx.query<T>(sql, params);
          return { rows: result.rows };
        },
      }));
    },
    close: () => pglite.close(),
  };
}
