import type { Db } from "./db";
import { outboxPublished } from "./metrics";
import type { RabbitBroker } from "./rabbit";
import { withNextOutbox } from "./store";

export async function publishPending(db: Db, broker: RabbitBroker): Promise<number> {
  let published = 0;
  for (;;) {
    const did = await withNextOutbox(db, (jobId) => broker.publishInitial(jobId));
    if (!did) {
      break;
    }
    outboxPublished.inc();
    published += 1;
  }
  return published;
}
