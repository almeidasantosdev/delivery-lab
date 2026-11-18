import { backoffMs, deliveryOutcome } from "./backoff.js";
import type { Db } from "./db.js";
import { log } from "./log.js";
import { deliveryAttempts } from "./metrics.js";
import { claimDueJob, finishJob } from "./store.js";

export type ProcessOptions = {
  backoffBaseMs?: number;
  staleProcessingMs?: number;
};

export async function processOnce(db: Db, options: ProcessOptions = {}): Promise<"idle" | "delivered" | "retry" | "failed"> {
  const job = await claimDueJob(db, options.staleProcessingMs ?? 30_000);
  if (!job) {
    return "idle";
  }

  const outcome = deliveryOutcome(job.attempts, job.fail_until_attempt);
  const result = await finishJob(db, job, outcome, outcome.ok ? 0 : backoffMs(job.attempts, options.backoffBaseMs ?? 1000));
  deliveryAttempts.inc({ result });
  log("info", "entrega processada", { jobId: Number(job.id), attempt: job.attempts, result });
  return result;
}

export function startWorker(db: Db, intervalMs: number): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    processOnce(db)
      .catch((error: unknown) => {
        log("error", "falha no worker", { error: error instanceof Error ? error.message : "erro desconhecido" });
      })
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
