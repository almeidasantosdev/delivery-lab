import { readConfig } from "./config.js";
import { createPgDb } from "./db.js";
import { log } from "./log.js";

const config = readConfig(process.env);
const db = createPgDb(config.databaseUrl);

await db.migrate();
await db.close();
log("info", "schema aplicado");
