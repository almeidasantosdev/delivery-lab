import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module";
import { readConfig } from "./config";
import { log } from "./log";

async function bootstrap(): Promise<void> {
  const config = readConfig(process.env);
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn"] });
  app.use(json({ limit: "256kb" }));
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
  log("info", "api ouvindo", { port: config.port });
}

bootstrap().catch((error: unknown) => {
  log("error", "api nao iniciou", { error: error instanceof Error ? error.message : "erro desconhecido" });
  process.exit(1);
});
