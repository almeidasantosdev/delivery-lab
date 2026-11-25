import { Body, Controller, Get, Inject, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { DB } from "./database.module";
import type { Db } from "./db";
import { log } from "./log";
import { register, webhookEvents } from "./metrics";
import { acceptWebhook, getJob, getWebhook } from "./store";
import { HttpError, parseWebhook } from "./validate";

@Controller()
export class ApiController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get("health")
  async health(): Promise<{ status: string }> {
    await this.db.query("SELECT 1");
    return { status: "ok" };
  }

  @Get("metrics")
  async metrics(@Res() res: Response): Promise<void> {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  }

  @Post("webhooks/payments")
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const input = parseWebhook(body);
    const accepted = await acceptWebhook(this.db, input);
    webhookEvents.inc({ result: accepted.duplicate ? "duplicate" : "accepted" });
    log("info", "webhook recebido", {
      idempotencyKey: accepted.idempotencyKey,
      jobId: accepted.jobId,
      duplicate: accepted.duplicate,
    });
    res.status(accepted.duplicate ? 200 : 202);
    return {
      duplicate: accepted.duplicate,
      idempotency_key: accepted.idempotencyKey,
      event_id: accepted.eventId,
      job_id: accepted.jobId,
      status: accepted.status,
    };
  }

  @Get("webhooks/:key")
  async webhook(@Param("key") key: string): Promise<Record<string, unknown>> {
    const webhook = await getWebhook(this.db, key);
    if (!webhook) {
      throw new HttpError(404, "webhook nao encontrado");
    }
    return {
      idempotency_key: webhook.idempotencyKey,
      event_type: webhook.eventType,
      status: webhook.status,
      payload: webhook.payload,
      job: {
        id: webhook.job.id,
        status: webhook.job.status,
        attempts: webhook.job.attempts,
        max_attempts: webhook.job.maxAttempts,
        fail_until_attempt: webhook.job.failUntilAttempt,
        last_error: webhook.job.lastError,
        next_attempt_at: webhook.job.nextAttemptAt,
      },
    };
  }

  @Get("jobs/:id")
  async job(@Param("id") rawId: string): Promise<Record<string, unknown>> {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 1) {
      throw new HttpError(400, "id invalido");
    }
    const job = await getJob(this.db, id);
    if (!job) {
      throw new HttpError(404, "job nao encontrado");
    }
    return {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      fail_until_attempt: job.failUntilAttempt,
      last_error: job.lastError,
      next_attempt_at: job.nextAttemptAt,
    };
  }
}
