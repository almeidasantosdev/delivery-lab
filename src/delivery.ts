import { backoffMs, deliveryOutcome } from "./backoff";
import type { Db } from "./db";
import { log } from "./log";
import { deliveryAttempts } from "./metrics";
import type { RabbitBroker } from "./rabbit";
import { claimJobById, finishJob, getJobRow, type JobRow } from "./store";

export type DeliveryOptions = {
  backoffBaseMs?: number;
};

export async function handleDelivery(
  db: Db,
  broker: RabbitBroker,
  jobId: number,
  attempt: number,
  options: DeliveryOptions = {},
  redelivered = false,
  depth = 0,
): Promise<"delivered" | "retry" | "failed" | "idle"> {
  if (depth > 3) {
    return "idle";
  }

  const job = await getJobRow(db, jobId);
  if (!job) {
    return "idle";
  }
  if (job.status === "delivered" || job.status === "failed") {
    return job.status;
  }
  if (job.attempts > attempt) {
    return "idle";
  }

  if (job.status === "pending" && job.attempts === attempt) {
    const waitMs = Math.max(1, asDate(job.next_attempt_at).getTime() - Date.now());
    await broker.publishRetry(jobId, attempt + 1, waitMs);
    return "retry";
  }

  if (job.status === "processing" && job.attempts === attempt && redelivered) {
    return route(db, broker, job, options);
  }

  if (job.status === "pending" && job.attempts === attempt - 1) {
    const waitMs = asDate(job.next_attempt_at).getTime() - Date.now();
    if (waitMs > 50) {
      await broker.publishRetry(jobId, attempt, waitMs);
      return "retry";
    }
    const claimed = await claimJobById(db, jobId, attempt - 1);
    if (!claimed) {
      return handleDelivery(db, broker, jobId, attempt, options, redelivered, depth + 1);
    }
    return route(db, broker, claimed, options);
  }

  return "idle";
}

async function route(
  db: Db,
  broker: RabbitBroker,
  job: JobRow,
  options: DeliveryOptions,
): Promise<"delivered" | "retry" | "failed"> {
  const outcome = deliveryOutcome(job.attempts, job.fail_until_attempt);
  const backoff = outcome.ok ? 0 : backoffMs(job.attempts, options.backoffBaseMs ?? 1000);
  const result = await finishJob(db, job, outcome, backoff);
  if (result === "retry") {
    await broker.publishRetry(numberId(job.id), job.attempts + 1, backoff);
  }
  if (result === "failed") {
    await broker.publishDead(numberId(job.id), job.attempts);
  }
  deliveryAttempts.inc({ result });
  log("info", "entrega processada", { jobId: numberId(job.id), attempt: job.attempts, result });
  return result;
}

function numberId(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
