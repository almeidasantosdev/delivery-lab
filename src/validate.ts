export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type WebhookInput = {
  idempotencyKey: string;
  eventType: string;
  payload: Record<string, unknown>;
  failUntilAttempt: number;
};

export function parseWebhook(body: unknown): WebhookInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "corpo JSON invalido");
  }

  const record = body as Record<string, unknown>;
  const idempotencyKey = readText(record.idempotency_key, "idempotency_key", 200);
  const eventType = readText(record.event_type, "event_type", 120);
  const payload = readPayload(record.payload);
  const failUntilAttempt = readFailUntil(record.fail_until_attempt);

  return { idempotencyKey, eventType, payload, failUntilAttempt };
}

function readText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} deve ser texto`);
  }
  const text = value.trim();
  if (!text || text.length > max) {
    throw new HttpError(400, `${field} deve ter entre 1 e ${max} caracteres`);
  }
  return text;
}

function readPayload(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "payload deve ser um objeto");
  }
  return value as Record<string, unknown>;
}

function readFailUntil(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10) {
    throw new HttpError(400, "fail_until_attempt deve ser um inteiro de 0 a 10");
  }
  return value;
}
