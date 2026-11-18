import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readConfig } from "../config.js";
import { HttpError, parseWebhook } from "../validate.js";

describe("configuracao", () => {
  it("exige a URL do banco e aplica portas padrao", () => {
    assert.throws(() => readConfig({}), /DATABASE_URL/);
    assert.deepEqual(readConfig({ DATABASE_URL: "postgres://local/delivery" }), {
      databaseUrl: "postgres://local/delivery",
      port: 3000,
      workerIntervalMs: 2000,
    });
  });
});

describe("validacao do webhook", () => {
  it("aceita o corpo minimo", () => {
    assert.deepEqual(
      parseWebhook({ idempotency_key: "evt_1", event_type: "payment.confirmed" }),
      {
        idempotencyKey: "evt_1",
        eventType: "payment.confirmed",
        payload: {},
        failUntilAttempt: 0,
      },
    );
  });

  it("rejeita falha simulada fora do intervalo", () => {
    assert.throws(
      () => parseWebhook({ idempotency_key: "evt_1", event_type: "payment.confirmed", fail_until_attempt: 11 }),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
  });
});
