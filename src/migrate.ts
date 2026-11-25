import { readConfig } from "./config";
import { createPgDb } from "./db";
import { log } from "./log";

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const db = createPgDb(config.databaseUrl);
  await db.migrate();
  await db.close();
  log("info", "schema aplicado");
}

main().catch((error: unknown) => {
  log("error", "migracao falhou", { error: error instanceof Error ? error.message : "erro desconhecido" });
  process.exit(1);
});
