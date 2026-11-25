import { readConfig, readWorkerConfig } from "./config";
import { HttpError, parseWebhook } from "./validate";

describe("configuracao", () => {
  it("exige a URL do banco e aplica os padroes", () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
    expect(readConfig({ DATABASE_URL: "postgres://local/delivery" })).toEqual({
      databaseUrl: "postgres://local/delivery",
      port: 3000,
      workerIntervalMs: 2000,
      workerHealthPort: 3001,
      backoffBaseMs: 1000,
      rabbitmqUrl: null,
    });
  });

  it("exige o RabbitMQ no worker", () => {
    expect(() => readWorkerConfig({ DATABASE_URL: "postgres://local/delivery" })).toThrow(/RABBITMQ_URL/);
    expect(readWorkerConfig({
      DATABASE_URL: "postgres://local/delivery",
      RABBITMQ_URL: "amqp://local",
    }).rabbitmqUrl).toBe("amqp://local");
  });
});

describe("validacao do webhook", () => {
  it("aceita o corpo minimo", () => {
    expect(parseWebhook({ idempotency_key: "evt_1", event_type: "payment.confirmed" })).toEqual({
      idempotencyKey: "evt_1",
      eventType: "payment.confirmed",
      payload: {},
      failUntilAttempt: 0,
    });
  });

  it("rejeita falha simulada fora do intervalo", () => {
    expect(() => parseWebhook({
      idempotency_key: "evt_1",
      event_type: "payment.confirmed",
      fail_until_attempt: 11,
    })).toThrow(HttpError);
  });
});
