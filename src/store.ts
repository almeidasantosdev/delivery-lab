import type { Db } from "./db";
import { HttpError, type WebhookInput } from "./validate";

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

export type JobRow = {
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
    const jobId = asId(job.rows[0].id);
    await tx.query(`INSERT INTO outbox (job_id) VALUES ($1)`, [jobId]);

    return {
      duplicate: false,
      eventId,
      jobId,
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

const jobColumns = `id, webhook_event_id, status, attempts, max_attempts, fail_until_attempt, last_error, next_attempt_at`;

export async function getJobRow(db: Db, jobId: number): Promise<JobRow | null> {
  const result = await db.query<JobRow>(
    `SELECT ${jobColumns} FROM delivery_jobs WHERE id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

export async function claimJobById(db: Db, jobId: number, expectedAttempts: number): Promise<JobRow | null> {
  const result = await db.query<JobRow>(
    `UPDATE delivery_jobs
     SET status = 'processing',
         attempts = attempts + 1,
         updated_at = now()
     WHERE id = $1
       AND status = 'pending'
       AND attempts = $2
     RETURNING ${jobColumns}`,
    [jobId, expectedAttempts],
  );
  return result.rows[0] ?? null;
}

export async function withNextOutbox(
  db: Db,
  publish: (jobId: number) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const pending = await tx.query<{ id: string | number; job_id: string | number }>(
      `SELECT id, job_id
       FROM outbox
       WHERE status = 'pending'
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = pending.rows[0];
    if (!row) {
      return false;
    }
    await publish(asId(row.job_id));
    await tx.query(
      `UPDATE outbox SET status = 'published', published_at = now() WHERE id = $1`,
      [asId(row.id)],
    );
    return true;
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
