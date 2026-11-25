import amqp, { type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";

export const JOBS_QUEUE = "delivery.jobs";
export const DEAD_QUEUE = "delivery.jobs.dlq";
const EXCHANGE = "delivery";
const DEAD_EXCHANGE = "delivery.dlx";
const RETRY_DELAYS_MS = [1, 1000, 2000, 4000, 8000, 16000, 32000, 60000];

export function retryDelay(ms: number): number {
  const wanted = Math.max(1, ms);
  return RETRY_DELAYS_MS.find((step) => step >= wanted) ?? 60_000;
}

export function retryQueue(ms: number): string {
  return `delivery.retry.${retryDelay(ms)}`;
}

export function retryQueues(): string[] {
  return RETRY_DELAYS_MS.map((ms) => retryQueue(ms));
}

export type DeliveryMessage = {
  jobId: number;
  attempt: number;
};

export class RabbitBroker {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly connection: ChannelModel,
    readonly channel: ConfirmChannel,
  ) {}

  async publishInitial(jobId: number): Promise<void> {
    await this.send(EXCHANGE, "jobs", { jobId, attempt: 1 });
  }

  async publishRetry(jobId: number, attempt: number, delayMs: number): Promise<void> {
    await this.send("", retryQueue(delayMs), { jobId, attempt });
  }

  async publishDead(jobId: number, attempt: number): Promise<void> {
    await this.send(DEAD_EXCHANGE, "jobs.dead", { jobId, attempt });
  }

  async ping(): Promise<void> {
    await this.enqueue(async () => {
      await this.channel.checkQueue(JOBS_QUEUE);
    });
  }

  async consume(onMessage: (message: DeliveryMessage, raw: ConsumeMessage) => Promise<void>): Promise<Channel> {
    const consumer = await this.connection.createChannel();
    await consumer.prefetch(1);
    await consumer.consume(JOBS_QUEUE, (raw) => {
      if (!raw) {
        return;
      }
      void this.handle(consumer, raw, onMessage);
    });
    return consumer;
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }

  private async handle(
    consumer: Channel,
    raw: ConsumeMessage,
    onMessage: (message: DeliveryMessage, raw: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    try {
      const message = parseMessage(raw);
      await onMessage(message, raw);
      consumer.ack(raw);
    } catch {
      if (raw.fields.redelivered) {
        consumer.nack(raw, false, false);
        return;
      }
      consumer.nack(raw, false, true);
    }
  }

  private send(exchange: string, routingKey: string, message: DeliveryMessage): Promise<void> {
    return this.enqueue(async () => {
      this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: "application/json",
      });
      await this.channel.waitForConfirms();
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export async function createBroker(url: string): Promise<RabbitBroker> {
  const connection = await amqp.connect(url);
  connection.on("error", () => undefined);
  const channel = await connection.createConfirmChannel();
  await assertTopology(channel);
  return new RabbitBroker(connection, channel);
}

async function assertTopology(channel: ConfirmChannel): Promise<void> {
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EXCHANGE, "topic", { durable: true });
  for (const delay of RETRY_DELAYS_MS) {
    await channel.assertQueue(retryQueue(delay), {
      durable: true,
      arguments: {
        "x-message-ttl": delay,
        "x-dead-letter-exchange": EXCHANGE,
        "x-dead-letter-routing-key": "jobs",
      },
    });
  }
  await channel.assertQueue(DEAD_QUEUE, { durable: true });
  await channel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, "jobs.dead");
  await channel.assertQueue(JOBS_QUEUE, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": DEAD_EXCHANGE,
      "x-dead-letter-routing-key": "jobs.dead",
    },
  });
  await channel.bindQueue(JOBS_QUEUE, EXCHANGE, "jobs");
}

function parseMessage(raw: ConsumeMessage): DeliveryMessage {
  const body = JSON.parse(raw.content.toString()) as Partial<DeliveryMessage>;
  if (!Number.isInteger(body.jobId) || !Number.isInteger(body.attempt) || (body.jobId ?? 0) < 1 || (body.attempt ?? 0) < 1) {
    throw new Error("mensagem invalida");
  }
  return { jobId: body.jobId as number, attempt: body.attempt as number };
}
