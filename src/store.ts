import type { Db } from "./db.js";
import { HttpError, type WebhookInput } from "./validate.js";

export type AcceptedWebhook = {
  duplicate: boolean;
  eventId: number;
  jobId: number;
  status: string;
  idempotencyKey: string;
};

export type JobView = {
  id: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  failUntilAttempt: number;
  lastError: string | null;
  nextAttemptAt: string;
};

export type WebhookView = {
  idempotencyKey: string;
  eventType: string;
  status: string;
  payload: Record<string, unknown>;
  job: JobView;
};

type JobRow = {
  id: string | number;
  webhook_event_id: string | number;
  status: string;
  attempts: number;
  max_attempts: number;
  fail_until_attempt: number;
  last_error: string | null;
  next_attempt_at: Date | string;
};

export async function acceptWebhook(db: Db, input: WebhookInput): Promise<AcceptedWebhook> {
  return db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string | number }>(
      `INSERT INTO webhook_events (idempotency_key, event_type, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.idempotencyKey, input.eventType, JSON.stringify(input.payload)],
    );

    if (inserted.rows.length === 0) {
      const existing = await tx.query<{ event_id: string | number; job_id: string | number; status: string }>(
        `SELECT e.id AS event_id, j.id AS job_id, e.status
         FROM webhook_events e
         JOIN delivery_jobs j ON j.webhook_event_id = e.id
         WHERE e.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new HttpError(409, "evento duplicado ainda sem job");
      }
      return {
        duplicate: true,
        eventId: asId(row.event_id),
        jobId: asId(row.job_id),
        status: row.status,
        idempotencyKey: input.idempotencyKey,
      };
    }

    const eventId = asId(inserted.rows[0].id);
    const job = await tx.query<{ id: string | number }>(
      `INSERT INTO delivery_jobs (webhook_event_id, fail_until_attempt)
       VALUES ($1, $2)
       RETURNING id`,
      [eventId, input.failUntilAttempt],
    );

    return {
      duplicate: false,
      eventId,
      jobId: asId(job.rows[0].id),
      status: "accepted",
      idempotencyKey: input.idempotencyKey,
    };
  });
}

export async function getWebhook(db: Db, idempotencyKey: string): Promise<WebhookView | null> {
  const result = await db.query<{
    idempotency_key: string;
    event_type: string;
    status: string;
    payload: Record<string, unknown> | string;
    job_id: string | number;
    job_status: string;
    attempts: number;
    max_attempts: number;
    fail_until_attempt: number;
    last_error: string | null;
    next_attempt_at: Date | string;
  }>(
    `SELECT e.idempotency_key, e.event_type, e.status, e.payload,
            j.id AS job_id, j.status AS job_status, j.attempts, j.max_attempts,
            j.fail_until_attempt, j.last_error, j.next_attempt_at
     FROM webhook_events e
     JOIN delivery_jobs j ON j.webhook_event_id = e.id
     WHERE e.idempotency_key = $1`,
    [idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    status: row.status,
    payload: asObject(row.payload),
    job: {
      id: asId(row.job_id),
      status: row.job_status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      failUntilAttempt: row.fail_until_attempt,
      lastError: row.last_error,
      nextAttemptAt: asIso(row.next_attempt_at),
    },
  };
}

export async function getJob(db: Db, jobId: number): Promise<JobView | null> {
  const result = await db.query<JobRow>(
    `SELECT id, webhook_event_id, status, attempts, max_attempts, fail_until_attempt, last_error, next_attempt_at
     FROM delivery_jobs
     WHERE id = $1`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return toJob(row);
}

export async function claimDueJob(db: Db, staleProcessingMs: number): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    await tx.query(
      `UPDATE delivery_jobs
       SET status = 'pending', updated_at = now()
       WHERE status = 'processing'
         AND updated_at < now() - ($1::int * interval '1 millisecond')`,
      [staleProcessingMs],
    );

    const claimed = await tx.query<JobRow>(
      `WITH candidate AS (
         SELECT id
         FROM delivery_jobs
         WHERE status = 'pending'
           AND next_attempt_at <= now()
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE delivery_jobs AS j
       SET status = 'processing',
           attempts = j.attempts + 1,
           updated_at = now()
       FROM candidate
       WHERE j.id = candidate.id
       RETURNING j.id, j.webhook_event_id, j.status, j.attempts, j.max_attempts,
                 j.fail_until_attempt, j.last_error, j.next_attempt_at`,
    );

    return claimed.rows[0] ?? null;
  });
}

export async function finishJob(
  db: Db,
  job: JobRow,
  outcome: { ok: true } | { ok: false; error: string },
  backoff: number,
): Promise<"delivered" | "retry" | "failed"> {
  const jobId = asId(job.id);
  const eventId = asId(job.webhook_event_id);

  if (outcome.ok) {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE delivery_jobs
         SET status = 'delivered', last_error = NULL, updated_at = now()
         WHERE id = $1`,
        [jobId],
      );
      await tx.query(`UPDATE webhook_events SET status = 'delivered' WHERE id = $1`, [eventId]);
    });
    return "delivered";
  }

  if (job.attempts >= job.max_attempts) {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE delivery_jobs
         SET status = 'failed', last_error = $2, updated_at = now()
         WHERE id = $1`,
        [jobId, outcome.error],
      );
      await tx.query(`UPDATE webhook_events SET status = 'failed' WHERE id = $1`, [eventId]);
    });
    return "failed";
  }

  await db.query(
    `UPDATE delivery_jobs
     SET status = 'pending',
         last_error = $2,
         next_attempt_at = now() + ($3::int * interval '1 millisecond'),
         updated_at = now()
     WHERE id = $1`,
    [jobId, outcome.error, backoff],
  );
  return "retry";
}

function toJob(row: JobRow): JobView {
  return {
    id: asId(row.id),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    failUntilAttempt: row.fail_until_attempt,
    lastError: row.last_error,
    nextAttemptAt: asIso(row.next_attempt_at),
  };
}

function asId(value: string | number): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new Error("id fora do intervalo seguro");
  }
  return id;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function asObject(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value;
}
