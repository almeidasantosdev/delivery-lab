import { Counter, Registry, collectDefaultMetrics } from "@prometheus-io/client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequests = new Counter({
  name: "http_requests_total",
  help: "Total de requisicoes HTTP",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});

export const webhookEvents = new Counter({
  name: "webhook_events_total",
  help: "Webhooks recebidos",
  labelNames: ["result"] as const,
  registers: [register],
});

export const deliveryAttempts = new Counter({
  name: "delivery_attempts_total",
  help: "Tentativas de entrega ao provedor simulado",
  labelNames: ["result"] as const,
  registers: [register],
});

export const outboxPublished = new Counter({
  name: "outbox_published_total",
  help: "Mensagens do outbox publicadas no RabbitMQ",
  registers: [register],
});
